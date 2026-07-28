/**
 * Authentification de bout en bout, sur vraie base Postgres éphémère et vraie app NestJS
 * (pas de mock du service de session ni de la base). Couvre le contrat gelé §4, endpoints
 * #1-#3, et le comportement de GardeSession (§2.10).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemo, ajouterUtilisateurFixture, type GarageDemoFixture, type UtilisateurFixture } from '../fixtures/garage-demo';
import {
  creerAppTest,
  demarrerRedisEphemere,
  obtenirEnteteCookie,
  extraireValeurCookie,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';

const CHEMIN_CONNEXION = '/api/v1/auth/connexion';
const CHEMIN_DECONNEXION = '/api/v1/auth/deconnexion';
const CHEMIN_MOI = '/api/v1/auth/moi';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let demo: GarageDemoFixture;
let utilisateurA: UtilisateurFixture;

async function connecter(email: string, motDePasse: string) {
  return ctx.requete.post(CHEMIN_CONNEXION).set('Origin', ctx.config.WEB_URL_PUBLIQUE).send({ email, motDePasse });
}

/** Connecte réellement via HTTP puis retrouve l'id de la session en base (empreinte = sha256
 *  du jeton en clair porté par le cookie) — nécessaire pour manipuler expire_le/vu_le via
 *  `ctx.horloge` dans les tests d'expiration. */
async function connecterEtRecupererSession(utilisateur: UtilisateurFixture) {
  const reponse = await connecter(utilisateur.email, utilisateur.motDePasseClair);
  if (reponse.status !== 200) {
    throw new Error(`connexion de test échouée (${reponse.status}) : ${JSON.stringify(reponse.body)}`);
  }
  const tokenClair = extraireValeurCookie(reponse, ctx.config.SESSION_COOKIE_NOM);
  const empreinte = createHash('sha256').update(tokenClair).digest();
  const { rows } = await ctx.poolMigrateur.query<{ id: string }>('select id from session where empreinte_token = $1', [
    empreinte,
  ]);
  if (rows.length !== 1) {
    throw new Error('session introuvable en base juste après une connexion réussie');
  }
  return { tokenClair, sessionId: rows[0]!.id };
}

function cookieDe(tokenClair: string): string {
  return `${ctx.config.SESSION_COOKIE_NOM}=${tokenClair}`;
}

let compteurUtilisateursDeTest = 0;

/** Fixture dédiée à un seul test, avec un email jamais réutilisé ailleurs dans ce fichier.
 *
 *  Nécessaire pour "validité de session" et "déconnexion" : `verifierLimitationDebit` (voir
 *  authentification.service.ts) consomme le même budget Redis `LIMITE_CONNEXION_COMPTE` par
 *  email pour TOUTE tentative de connexion, y compris les connexions RÉUSSIES — pas seulement
 *  les échecs. Réutiliser `utilisateurA` pour connecter/reconnecter dans chacun des 6 tests de
 *  ces deux describe (en plus des 3 déjà faits sur ce même email dans "connexion réussie" et
 *  "connexion refusée") dépasserait le budget par défaut (5 / 900s) et ferait échouer ces tests
 *  sur un 429 sans rapport avec ce qu'ils vérifient (expiration, inactivité, suspension,
 *  déconnexion). Une fixture dédiée par test isole chacun de ce budget partagé — voir aussi le
 *  signalement dans la réponse finale de la mission : le couplage entre rate-limiting Redis et
 *  verrouillage de compte (tous deux à 5 par défaut) mériterait d'être revu côté src/auth. */
async function nouvelUtilisateurDeTest(): Promise<UtilisateurFixture> {
  compteurUtilisateursDeTest += 1;
  return ajouterUtilisateurFixture(bdd, demo.tenantA.id, {
    prenom: 'Test',
    nom: `SessionUnitaire${compteurUtilisateursDeTest}`,
    role: 'technicien',
    email: `test.session.${compteurUtilisateursDeTest}@garage-martin.test`,
  });
}

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  utilisateurA = demo.tenantA.utilisateurs[0]!;
}, 180_000);

afterAll(async () => {
  // Défensif : si `beforeAll` a échoué avant d'initialiser une ressource, `?.` évite de
  // masquer la VRAIE erreur (celle du beforeAll) derrière un TypeError secondaire ici.
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('connexion réussie', () => {
  it('une connexion valide rend 200, le corps SessionCourante, et un cookie de session aux bons attributs', async () => {
    const reponse = await connecter(utilisateurA.email, utilisateurA.motDePasseClair);

    expect(reponse.status).toBe(200);
    expect(reponse.body.utilisateur.email).toBe(utilisateurA.email);
    expect(reponse.body.utilisateur.role).toBe(utilisateurA.role);
    expect(reponse.body.tenant.id).toBe(demo.tenantA.id);
    expect(typeof reponse.body.expireLe).toBe('string');

    const cookieBrut = obtenirEnteteCookie(reponse, ctx.config.SESSION_COOKIE_NOM);
    expect(cookieBrut).toMatch(/HttpOnly/i);
    expect(cookieBrut).toMatch(/SameSite=Lax/i);
    expect(cookieBrut).toMatch(/Path=\//);
    expect(cookieBrut).toMatch(new RegExp(`Max-Age=${ctx.config.SESSION_DUREE_MINUTES * 60}`));
    if (ctx.config.COOKIE_SECURE) {
      expect(cookieBrut).toMatch(/Secure/i);
    }
  });

  it("le jeton de session en clair n'apparaît ni en base ni dans les journaux applicatifs (stdout/stderr)", async () => {
    const sortiesCapturees: string[] = [];
    const capter = (chunk: unknown): boolean => {
      sortiesCapturees.push(String(chunk));
      return true;
    };
    const espionSortie = vi.spyOn(process.stdout, 'write').mockImplementation(capter as never);
    const espionErreur = vi.spyOn(process.stderr, 'write').mockImplementation(capter as never);

    let tokenClair: string;
    try {
      const reponse = await connecter(utilisateurA.email, utilisateurA.motDePasseClair);
      expect(reponse.status).toBe(200);
      tokenClair = extraireValeurCookie(reponse, ctx.config.SESSION_COOKIE_NOM);
    } finally {
      espionSortie.mockRestore();
      espionErreur.mockRestore();
    }

    expect(tokenClair).toBeTruthy();
    const journaux = sortiesCapturees.join('');
    expect(journaux.includes(tokenClair)).toBe(false);

    const empreinteAttendue = createHash('sha256').update(tokenClair).digest();
    const { rows } = await ctx.poolMigrateur.query('select * from session where empreinte_token = $1', [empreinteAttendue]);
    expect(rows).toHaveLength(1);
    const ligneSerialisee = JSON.stringify(rows[0], (_cle, valeur) =>
      Buffer.isBuffer(valeur) ? valeur.toString('hex') : valeur,
    );
    expect(ligneSerialisee.includes(tokenClair)).toBe(false);
  });
});

describe('connexion refusée', () => {
  it('un email inconnu et un mot de passe faux rendent EXACTEMENT le même code — pas d\'énumération de comptes', async () => {
    const reponseEmailInconnu = await connecter('personne-nexiste-pas@garage-martin.test', 'peu importe le mot de passe');
    const reponseMotDePasseFaux = await connecter(utilisateurA.email, 'mauvais-mot-de-passe');

    expect(reponseEmailInconnu.status).toBe(401);
    expect(reponseMotDePasseFaux.status).toBe(401);
    expect(reponseEmailInconnu.body.code).toBe('AUTH_IDENTIFIANTS_INVALIDES');
    expect(reponseMotDePasseFaux.body.code).toBe('AUTH_IDENTIFIANTS_INVALIDES');
  });

  it('un Origin étranger sur une méthode non-GET est refusé avec 403 AUTH_ORIGINE_REFUSEE', async () => {
    const reponse = await ctx.requete
      .post(CHEMIN_CONNEXION)
      .set('Origin', 'https://site-attaquant.example')
      .send({ email: utilisateurA.email, motDePasse: utilisateurA.motDePasseClair });

    expect(reponse.status).toBe(403);
    expect(reponse.body.code).toBe('AUTH_ORIGINE_REFUSEE');
  });

  it('le compte est verrouillé (423) après SEUIL_VERROUILLAGE_COMPTE tentatives échouées consécutives, même avec le bon mot de passe ensuite', async () => {
    // Deux dispositifs anti-brute-force INDÉPENDANTS protègent /auth/connexion (voir
    // authentification.service.ts) : un verrouillage de compte progressif après
    // `SEUIL_VERROUILLAGE_COMPTE` échecs consécutifs — celui que ce test vérifie —, et une
    // limitation de débit Redis PAR EMAIL (`LIMITE_CONNEXION_COMPTE`). Avant la correction du
    // bloquant B1 (rapport QA étape 0), les deux seuils coïncidaient à 5 et le budget par email
    // était consommé même par une connexion RÉUSSIE : la 6e requête de ce test (mot de passe
    // correct, après 5 échecs) tombait systématiquement sur le 429 du rate-limiter Redis AVANT
    // d'atteindre le code qui rend 423, rendant le 423 documenté inatteignable. Ce test
    // s'exécutait alors sur une app de test dédiée avec un budget par email desserré à la main
    // pour isoler la mécanique de verrouillage de celle du rate-limiter.
    //
    // Ce contournement n'a plus lieu d'être : `SEUIL_VERROUILLAGE_COMPTE` est désormais
    // configurable et distinct de `LIMITE_CONNEXION_COMPTE` (15 par défaut, strictement
    // supérieur), et le budget par email n'est plus consommé que sur ÉCHEC (bloquant B2) — une
    // connexion réussie ne le touche plus. Le test tourne donc directement sur `ctx`, avec la
    // configuration par défaut de test (voir envTest, app-test.ts), exactement comme en
    // production.
    const utilisateurVerrouillage = await ajouterUtilisateurFixture(bdd, demo.tenantA.id, {
      prenom: 'Test',
      nom: 'Verrouillage',
      role: 'technicien',
      email: 'test.verrouillage@garage-martin.test',
    });

    for (let tentative = 0; tentative < ctx.config.SEUIL_VERROUILLAGE_COMPTE; tentative += 1) {
      const reponse = await connecter(utilisateurVerrouillage.email, 'mauvais-mot-de-passe');
      expect(reponse.status).toBe(401);
    }

    const reponseApresVerrouillage = await connecter(utilisateurVerrouillage.email, utilisateurVerrouillage.motDePasseClair);
    expect(reponseApresVerrouillage.status).toBe(423);
    expect(reponseApresVerrouillage.body.code).toBe('AUTH_COMPTE_VERROUILLE');
  });
});

describe('validité de session', () => {
  it('une session dont l\'expiration absolue est dépassée est refusée (401) même si elle a été "vue" à l\'instant', async () => {
    const utilisateur = await nouvelUtilisateurDeTest();
    const { tokenClair, sessionId } = await connecterEtRecupererSession(utilisateur);
    await ctx.horloge.fixerDerniereActiviteSession(sessionId, new Date());
    // La contrainte `session_expire_le_coherent_chk` (expire_le > cree_le) interdit de reculer
    // expire_le à une date arbitraire dans le passé : la session vient d'être créée, donc
    // `cree_le` est lui-même quasiment "maintenant". On la fixe juste après `cree_le` (encore
    // valide au regard de la contrainte) — le temps que la requête HTTP suivante parte suffit à
    // ce qu'elle soit déjà dans le passé au moment où l'application la relit.
    const { rows } = await ctx.poolMigrateur.query<{ cree_le: Date }>('select cree_le from session where id = $1', [
      sessionId,
    ]);
    const creeLe = rows[0]!.cree_le;
    await ctx.horloge.fixerExpirationSession(sessionId, new Date(creeLe.getTime() + 1));

    const reponse = await ctx.requete.get(CHEMIN_MOI).set('Cookie', cookieDe(tokenClair));
    expect(reponse.status).toBe(401);
  });

  it("une session inactive au-delà du seuil glissant (SESSION_INACTIVITE_MINUTES) est refusée (401) même si l'expiration absolue n'est pas atteinte", async () => {
    const utilisateur = await nouvelUtilisateurDeTest();
    const { tokenClair, sessionId } = await connecterEtRecupererSession(utilisateur);
    await ctx.horloge.fixerExpirationSession(sessionId, new Date(Date.now() + 6 * 3_600_000)); // très loin dans le futur
    await ctx.horloge.fixerDerniereActiviteSession(
      sessionId,
      new Date(Date.now() - (ctx.config.SESSION_INACTIVITE_MINUTES + 5) * 60_000),
    );

    const reponse = await ctx.requete.get(CHEMIN_MOI).set('Cookie', cookieDe(tokenClair));
    expect(reponse.status).toBe(401);
  });

  it('un utilisateur passé "suspendu" voit sa session invalidée dès la requête suivante', async () => {
    const utilisateur = await nouvelUtilisateurDeTest();
    const { tokenClair } = await connecterEtRecupererSession(utilisateur);
    await bdd.poolMigrateur.query("update utilisateur set statut = 'suspendu' where id = $1", [utilisateur.id]);
    try {
      const reponse = await ctx.requete.get(CHEMIN_MOI).set('Cookie', cookieDe(tokenClair));
      expect(reponse.status).toBe(401);
    } finally {
      await bdd.poolMigrateur.query("update utilisateur set statut = 'actif' where id = $1", [utilisateur.id]);
    }
  });

  it('un tenant passé "suspendu" invalide toute session de ses utilisateurs dès la requête suivante', async () => {
    const utilisateur = await nouvelUtilisateurDeTest();
    const { tokenClair } = await connecterEtRecupererSession(utilisateur);
    // `tenant` est sous FORCE ROW LEVEL SECURITY : seul le superutilisateur peut le modifier
    // sans contexte tenant déjà posé (voir garage-demo.ts pour la même remarque sur le seed).
    await bdd.poolSuperutilisateur.query("update tenant set statut = 'suspendu' where id = $1", [demo.tenantA.id]);
    try {
      const reponse = await ctx.requete.get(CHEMIN_MOI).set('Cookie', cookieDe(tokenClair));
      expect(reponse.status).toBe(401);
    } finally {
      await bdd.poolSuperutilisateur.query("update tenant set statut = 'actif' where id = $1", [demo.tenantA.id]);
    }
  });
});

describe('déconnexion', () => {
  it('POST /auth/deconnexion est idempotent : 204 même sans session active, et efface le cookie', async () => {
    const premiereReponse = await ctx.requete.post(CHEMIN_DECONNEXION).set('Origin', ctx.config.WEB_URL_PUBLIQUE);
    expect(premiereReponse.status).toBe(204);

    const secondeReponse = await ctx.requete.post(CHEMIN_DECONNEXION).set('Origin', ctx.config.WEB_URL_PUBLIQUE);
    expect(secondeReponse.status).toBe(204);
  });

  it('après une déconnexion réelle, le jeton précédemment valide ne permet plus GET /auth/moi', async () => {
    const utilisateur = await nouvelUtilisateurDeTest();
    const { tokenClair } = await connecterEtRecupererSession(utilisateur);

    const reponseDeconnexion = await ctx.requete
      .post(CHEMIN_DECONNEXION)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookieDe(tokenClair));
    expect(reponseDeconnexion.status).toBe(204);

    const reponseMoi = await ctx.requete.get(CHEMIN_MOI).set('Cookie', cookieDe(tokenClair));
    expect(reponseMoi.status).toBe(401);
  });
});
