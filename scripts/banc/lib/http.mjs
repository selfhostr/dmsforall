/**
 * Client HTTP minimal pour le banc de charge — zéro dépendance (fetch natif Node 22).
 *
 * Authentification RÉELLE (pas de bypass) : `POST /auth/connexion` pose un cookie de session
 * HttpOnly (voir `apps/api/src/auth/cookie.ts`), rejoué ensuite sur chaque requête. L'en-tête
 * `Origin` est envoyé sur TOUTE requête (pas seulement les mutantes) — `GardeSession` ne l'exige
 * que sur méthode ≠ GET/HEAD (`apps/api/src/auth/garde-session.ts`), mais l'envoyer partout coûte
 * rien et évite le piège documenté dans CONTRIBUTING.md (403 anti-CSRF trompeur en CLI).
 *
 * `WEB_URL_PUBLIQUE` est lu depuis le `.env` réel du dépôt (jamais codé en dur) : sur ce poste il
 * vaut `http://192.168.1.10:5173`, pas `http://localhost:5173` — un Origin figé sur `localhost`
 * échouerait silencieusement en 403.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const RACINE_DEPOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Parseur `.env` volontairement minimal : `CLE=valeur`, une ligne, pas d'export/interpolation. */
function chargerEnv(chemin) {
  const valeurs = {};
  let contenu;
  try {
    contenu = readFileSync(chemin, 'utf8');
  } catch {
    return valeurs;
  }
  for (const ligneBrute of contenu.split('\n')) {
    const ligne = ligneBrute.trim();
    if (!ligne || ligne.startsWith('#')) continue;
    const indexEgal = ligne.indexOf('=');
    if (indexEgal === -1) continue;
    const cle = ligne.slice(0, indexEgal).trim();
    let valeur = ligne.slice(indexEgal + 1).trim();
    if (
      (valeur.startsWith('"') && valeur.endsWith('"')) ||
      (valeur.startsWith("'") && valeur.endsWith("'"))
    ) {
      valeur = valeur.slice(1, -1);
    }
    valeurs[cle] = valeur;
  }
  return valeurs;
}

const env = { ...chargerEnv(`${RACINE_DEPOT}.env`), ...process.env };

export const CONFIG_ENV = {
  port: env.PORT ?? '3000',
  origine: env.WEB_URL_PUBLIQUE ?? 'http://localhost:5173',
  nomCookie: env.SESSION_COOKIE_NOM ?? 'dfa_session',
};

export const URL_BASE_API = `http://localhost:${CONFIG_ENV.port}/api/v1`;

/**
 * Une session = un cookie + un budget de requêtes. `requete()` mesure du premier octet envoyé à
 * la dernière ligne du corps consommée (`await reponse.text()` inclus) — c'est la latence que
 * verrait un écran qui attend la réponse complète, pas seulement les en-têtes.
 */
export class SessionBanc {
  #cookie = null;

  async connecter(email, motDePasse) {
    const debut = performance.now();
    const reponse = await fetch(`${URL_BASE_API}/auth/connexion`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: CONFIG_ENV.origine,
      },
      body: JSON.stringify({ email, motDePasse }),
    });
    const dureeMs = performance.now() - debut;
    const corps = await reponse.text();
    if (!reponse.ok) {
      throw new Error(
        `Connexion refusée (${reponse.status}) — ${corps.slice(0, 300)}. ` +
          `Origin envoyé : ${CONFIG_ENV.origine}.`,
      );
    }
    const setCookie = reponse.headers.get('set-cookie');
    if (!setCookie) throw new Error('Connexion 200 mais aucun Set-Cookie reçu.');
    const match = setCookie.match(new RegExp(`${CONFIG_ENV.nomCookie}=([^;]+)`));
    if (!match) throw new Error(`Cookie ${CONFIG_ENV.nomCookie} absent du Set-Cookie.`);
    this.#cookie = `${CONFIG_ENV.nomCookie}=${match[1]}`;
    return { dureeMs, session: JSON.parse(corps) };
  }

  /**
   * Exécute une requête et rend sa latence (ms), son statut HTTP et son corps déjà parsé. Ne
   * lève JAMAIS sur un statut non-2xx — un 400/403/429 fait partie des résultats à mesurer, pas
   * une panne du banc.
   */
  /**
   * `nest start --watch` (le serveur de dev PARTAGÉ, jamais redémarré par ce banc — voir
   * README.md) redémarre à toute écriture d'un autre lot dans `apps/api/src/`, ce qui coupe
   * les connexions en vol (`fetch failed` / `UND_ERR_SOCKET`, observé en pratique le 27.08.2026).
   * Un tel accroc N'EST PAS une mesure de latence — il est retenté (3 tentatives, 400ms
   * d'attente) puis, s'il persiste, rendu comme `statut: -1` plutôt que de faire planter toute la
   * campagne : un banc qui s'arrête au premier aléa réseau ne serait rejouable qu'à condition que
   * rien d'autre ne touche jamais le dépôt pendant qu'il tourne, une hypothèse fausse par
   * construction sur ce poste.
   */
  async requete(methode, chemin, { corps } = {}, tentative = 1) {
    if (!this.#cookie) throw new Error('SessionBanc.requete() appelé avant connecter().');
    const debut = performance.now();
    try {
      const reponse = await fetch(`${URL_BASE_API}${chemin}`, {
        method: methode,
        headers: {
          origin: CONFIG_ENV.origine,
          cookie: this.#cookie,
          ...(corps ? { 'content-type': 'application/json' } : {}),
        },
        body: corps ? JSON.stringify(corps) : undefined,
      });
      const texte = await reponse.text();
      const dureeMs = performance.now() - debut;
      let corpsJson = null;
      try {
        corpsJson = texte ? JSON.parse(texte) : null;
      } catch {
        corpsJson = null;
      }
      return {
        statut: reponse.status,
        ok: reponse.ok,
        dureeMs,
        corps: corpsJson,
        texteBrut: texte,
      };
    } catch (erreur) {
      // 8 tentatives à 1.5s : assez large pour survivre à un redémarrage `nest start --watch`
      // complet (recompilation incrémentale + reconnexion au pool Postgres), déclenché par un
      // AUTRE lot qui écrit dans `apps/api/src/` pendant que ce banc tourne — mesuré en
      // pratique le 27.08.2026 : 3 tentatives à 400ms ne suffisaient pas et faisaient perdre des
      // dizaines de mesures d'un coup au milieu de la campagne.
      if (tentative < 8) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return this.requete(methode, chemin, { corps }, tentative + 1);
      }
      return {
        statut: -1,
        ok: false,
        dureeMs: performance.now() - debut,
        corps: null,
        texteBrut: String(erreur),
      };
    }
  }
}
