/**
 * Client HTTP minimal pour le parcours `/api/v1/reprise/dossiers/**` — pas de dépendance externe
 * (fetch global, Node ≥ 18), juste ce qu'il faut pour rejouer le parcours mesuré manuellement le
 * 25.08.2026 par script plutôt que par requêtes tapées à la main.
 *
 * DEUX PIÈGES D'API DÉJÀ MESURÉS, encodés ici une fois pour ne plus les redécouvrir :
 *   - `Origin` obligatoire sur CHAQUE requête (garde-fou anti-CSRF, sinon 403 qui s'affiche comme
 *     un refus d'identifiants) ;
 *   - `Idempotency-Key` (uuid v4) obligatoire sur `POST /reprise/dossiers` et
 *     `POST .../plan/valider` — généré ici par défaut, mais l'appelant peut en fournir un pour
 *     PROUVER l'idempotence (même clé rejouée = même dossier/import, jamais un second).
 */
import { randomUUID } from 'node:crypto';

export interface SessionHttp {
  readonly apiUrl: string;
  readonly origine: string;
  readonly cookie: string; // "nom=valeur" — capturé depuis Set-Cookie à la connexion
}

export class ErreurApiReprise extends Error {
  constructor(
    public readonly statut: number,
    public readonly corps: unknown,
    methode: string,
    chemin: string,
  ) {
    super(
      `${methode} ${chemin} -> HTTP ${String(statut)} : ${
        typeof corps === 'object' ? JSON.stringify(corps) : String(corps)
      }`,
    );
    this.name = 'ErreurApiReprise';
  }
}

async function requete(
  session: Pick<SessionHttp, 'apiUrl' | 'origine'> & { cookie?: string },
  methode: string,
  chemin: string,
  options: {
    corpsJson?: unknown;
    corpsBrut?: Buffer;
    idempotencyKey?: string;
    accepterCorpsVide?: boolean;
  } = {},
): Promise<{ statut: number; corps: unknown; enTetes: Headers }> {
  const enTetes: Record<string, string> = { Origin: session.origine };
  if (session.cookie) enTetes['Cookie'] = session.cookie;
  if (options.idempotencyKey) enTetes['Idempotency-Key'] = options.idempotencyKey;

  let corps: BodyInit | undefined;
  if (options.corpsBrut) {
    enTetes['Content-Type'] = 'application/octet-stream';
    corps = new Uint8Array(options.corpsBrut);
  } else if (options.corpsJson !== undefined) {
    enTetes['Content-Type'] = 'application/json';
    corps = JSON.stringify(options.corpsJson);
  }

  const reponse = await fetch(`${session.apiUrl}${chemin}`, {
    method: methode,
    headers: enTetes,
    body: corps,
  });
  const texte = await reponse.text();
  let corpsParse: unknown = null;
  if (texte.length > 0) {
    try {
      corpsParse = JSON.parse(texte);
    } catch {
      corpsParse = texte;
    }
  }
  if (!reponse.ok && !options.accepterCorpsVide) {
    throw new ErreurApiReprise(reponse.status, corpsParse, methode, chemin);
  }
  return { statut: reponse.status, corps: corpsParse, enTetes: reponse.headers };
}

/** Capture le PREMIER `Set-Cookie` de la réponse sous forme `nom=valeur` (ignore les attributs
 *  `Path`/`HttpOnly`/... — inutiles pour un client scripté qui ne fait que renvoyer la paire). */
function capturerCookie(enTetes: Headers): string {
  const brut = enTetes.get('set-cookie');
  if (!brut) throw new Error('Connexion : aucun Set-Cookie dans la réponse — session non ouverte.');
  return brut.split(';', 1)[0]!;
}

export async function seConnecter(
  apiUrl: string,
  origine: string,
  email: string,
  motDePasse: string,
): Promise<SessionHttp> {
  const enTetes = { Origin: origine, 'Content-Type': 'application/json' };
  const reponse = await fetch(`${apiUrl}/api/v1/auth/connexion`, {
    method: 'POST',
    headers: enTetes,
    body: JSON.stringify({ email, motDePasse }),
  });
  const texte = await reponse.text();
  if (!reponse.ok) {
    throw new ErreurApiReprise(reponse.status, texte, 'POST', '/api/v1/auth/connexion');
  }
  return { apiUrl, origine, cookie: capturerCookie(reponse.headers) };
}

// ------------------------------------------------------------------------------------------------
// Dossier de reprise — un appel par endpoint, dans l'ordre du parcours (§ mission).
// ------------------------------------------------------------------------------------------------

export interface ReponseCreationDossier {
  readonly dossier: { readonly id: string; readonly statut: string };
  readonly tailleTrancheRecommandeeOctets: number;
}

export async function creerDossier(
  s: SessionHttp,
  params: {
    tailleOctetsAnnoncee: number;
    empreinteSha256Annoncee: string;
    nomArchiveOriginal?: string;
  },
  idempotencyKey = randomUUID(),
): Promise<ReponseCreationDossier> {
  const { corps } = await requete(s, 'POST', '/api/v1/reprise/dossiers', {
    corpsJson: params,
    idempotencyKey,
  });
  return corps as ReponseCreationDossier;
}

export async function deposerTranche(
  s: SessionHttp,
  dossierId: string,
  numero: number,
  donnees: Buffer,
): Promise<{ readonly octetsRecus: number; readonly toutesTranchesRecues: boolean }> {
  const { corps } = await requete(
    s,
    'PUT',
    `/api/v1/reprise/dossiers/${dossierId}/tranches/${String(numero)}`,
    {
      corpsBrut: donnees,
    },
  );
  return corps as { readonly octetsRecus: number; readonly toutesTranchesRecues: boolean };
}

export async function finaliserDossier(
  s: SessionHttp,
  dossierId: string,
  empreinteSha256Calculee: string,
): Promise<{ readonly statut: string }> {
  const { corps } = await requete(s, 'POST', `/api/v1/reprise/dossiers/${dossierId}/finaliser`, {
    corpsJson: { empreinteSha256Calculee },
  });
  return corps as { readonly statut: string };
}

export async function lancerAnalyse(s: SessionHttp, dossierId: string): Promise<void> {
  await requete(s, 'POST', `/api/v1/reprise/dossiers/${dossierId}/analyses`, {
    accepterCorpsVide: true,
  });
}

export async function lireAnalyse(s: SessionHttp, dossierId: string): Promise<unknown> {
  const { corps } = await requete(s, 'GET', `/api/v1/reprise/dossiers/${dossierId}/analyse`);
  return corps;
}

export async function lirePlan(s: SessionHttp, dossierId: string): Promise<unknown> {
  const { corps } = await requete(s, 'GET', `/api/v1/reprise/dossiers/${dossierId}/plan`);
  return corps;
}

export async function validerPlan(
  s: SessionHttp,
  dossierId: string,
  idempotencyKey = randomUUID(),
): Promise<unknown> {
  const { corps } = await requete(s, 'POST', `/api/v1/reprise/dossiers/${dossierId}/plan/valider`, {
    corpsJson: {},
    idempotencyKey,
  });
  return corps;
}

export async function lireImport(s: SessionHttp, dossierId: string): Promise<unknown> {
  const { corps } = await requete(s, 'GET', `/api/v1/reprise/dossiers/${dossierId}/import`);
  return corps;
}

export async function rejouerImport(s: SessionHttp, dossierId: string): Promise<void> {
  await requete(s, 'POST', `/api/v1/reprise/dossiers/${dossierId}/import/rejouer`, {
    accepterCorpsVide: true,
  });
}

export async function lireRapport(s: SessionHttp, dossierId: string): Promise<unknown> {
  const { corps } = await requete(s, 'GET', `/api/v1/reprise/dossiers/${dossierId}/rapport`);
  return corps;
}

export async function lireDossier(
  s: SessionHttp,
  dossierId: string,
): Promise<{ readonly statut: string }> {
  const { corps } = await requete(s, 'GET', `/api/v1/reprise/dossiers/${dossierId}`);
  return corps as { readonly statut: string };
}

export async function annulerDossier(
  s: SessionHttp,
  dossierId: string,
  motif: string,
): Promise<void> {
  await requete(s, 'POST', `/api/v1/reprise/dossiers/${dossierId}/annuler`, {
    corpsJson: { motif },
  });
}

/**
 * Attente active bornée de la SORTIE d'un ensemble de statuts « en cours » — l'analyse et l'import
 * sont asynchrones (job BullMQ), aucun webhook : la seule façon d'observer la fin est de repoller
 * `GET .../dossiers/{id}`.
 *
 * PAR SORTIE D'ENSEMBLE, PAS PAR ENTRÉE DANS UNE CIBLE — bug réel rencontré en écrivant ce harnais
 * (jeu synthétique, dossier de quelques Ko) : entre deux polls à 2 s d'intervalle, un dossier peut
 * enchaîner `analyse_en_cours -> analyse_terminee -> plan_propose` en moins de 2 secondes (le plan
 * se génère automatiquement, sans pause, dès l'analyse réussie). Une attente qui cherche
 * spécifiquement `analyse_terminee` ne voit alors JAMAIS cette valeur — elle observe directement
 * `plan_propose` — et boucle jusqu'au délai maximal (15 minutes) sur un dossier qui a en réalité
 * déjà réussi. Attendre la SORTIE de `statutsEnCours` (`depot_receptionne`, `analyse_en_cours`)
 * est robuste à ce genre de saut : quel que soit l'état sur lequel le dossier atterrit ENSUITE,
 * dès qu'il n'est plus dans l'ensemble « en cours », l'attente se termine et rend ce statut tel
 * quel à l'appelant, qui décide alors s'il s'agit d'un succès ou d'un échec.
 */
export async function attendreSortieStatuts(
  s: SessionHttp,
  dossierId: string,
  statutsEnCours: readonly string[],
  options: {
    intervalleMs?: number;
    delaiMaxMs?: number;
    surProgres?: (statut: string) => void;
  } = {},
): Promise<string> {
  const intervalle = options.intervalleMs ?? 2000;
  const delaiMax = options.delaiMaxMs ?? 15 * 60 * 1000; // 15 min : archive complète mesurée à ~7,5 min
  const debut = Date.now();
  let dernierStatut = '';
  for (;;) {
    const { statut } = await lireDossier(s, dossierId);
    if (statut !== dernierStatut) {
      dernierStatut = statut;
      options.surProgres?.(statut);
    }
    if (!statutsEnCours.includes(statut)) return statut;
    if (Date.now() - debut > delaiMax) {
      throw new Error(
        `Délai dépassé (${String(delaiMax)} ms) en attente de sortie de ` +
          `[${statutsEnCours.join(', ')}] — statut resté « ${statut} ».`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalle));
  }
}
