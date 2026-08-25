import type {
  ArchiveDeposeeReprise,
  EntreeAnnulationDossierReprise,
  EntreeCreationDossierReprise,
  EntreeFinalisationDepotReprise,
  EntreeModificationPlanReprise,
  EntreeRejouerImportReprise,
  PageDossierReprise,
  RapportImportReprise,
  ReponseAnalyseReprise,
  ReponseCreationDossierReprise,
  ReponseDossierReprise,
  ReponseImportReprise,
  ReponsePlanReprise,
  ReponseTrancheDeposee,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport de la reprise de données (`packages/shared/src/contrats/reprise.ts`) — types
 * consommés depuis `@dfa/shared`, jamais `api/types.gen.ts` (pas encore régénéré tant que le
 * module API n'est pas fusionné, voir la consigne de la mission : coder contre le contrat, ne pas
 * attendre l'implémentation serveur).
 *
 * AUCUN `GET /reprise/dossiers/{id}` dans le contrat : seule `listerDossiers` existe, c'est elle
 * qui sert de source de vérité au dossier « actif » (voir `useDossierRepriseActif`).
 */

const RACINE = '/reprise/dossiers';

/** `POST /reprise/dossiers` — `Idempotency-Key` obligatoire (création sensible, réserve un
 *  dossier). Ne transporte aucun octet : voir `deposerTranche` pour le corps binaire. */
export async function creerDossierReprise(
  entree: EntreeCreationDossierReprise,
  idempotencyKey: string,
): Promise<ReponseCreationDossierReprise> {
  const reponse = await requeteApi<ReponseCreationDossierReprise>(RACINE, {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /reprise/dossiers.');
  }
  return reponse;
}

/**
 * `PUT /reprise/dossiers/{id}/tranches/{numero}` — corps binaire brut (`application/octet-
 * stream`), PAS de schéma zod côté contrat (doctrine `vehicules/scan-permis-circulation.ts`).
 * Idempotent par construction (même numéro = écrasement sans effet de bord) : c'est ce qui rend
 * un retry après coupure réseau sûr, voir `useTeleversementArchive`.
 *
 * `signal` fourni par l'appelant : une tranche de plusieurs Mo peut dépasser largement le délai
 * par défaut de `requeteApi` (15 s) sur une connexion lente de garage — l'orchestrateur de dépôt
 * pose son propre délai, généreux, par tranche.
 */
export async function deposerTranche(
  dossierId: string,
  numero: number,
  octets: Blob,
  signal: AbortSignal,
): Promise<ReponseTrancheDeposee> {
  const reponse = await requeteApi<ReponseTrancheDeposee>(
    `${RACINE}/${dossierId}/tranches/${numero}`,
    {
      method: 'PUT',
      body: octets,
      headers: { 'Content-Type': 'application/octet-stream' },
      signal,
    },
  );
  if (!reponse) {
    throw new Error(`Réponse vide inattendue : PUT tranche ${numero}.`);
  }
  return reponse;
}

/** `GET /reprise/dossiers/{id}/tranches` — état de réception, c'est lui qui permet la reprise
 *  après interruption (`dernierNumeroTrancheRecuContigu`). */
export async function recupererTranches(dossierId: string): Promise<ArchiveDeposeeReprise> {
  const reponse = await requeteApi<ArchiveDeposeeReprise>(`${RACINE}/${dossierId}/tranches`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : GET tranches.');
  }
  return reponse;
}

/** `POST /reprise/dossiers/{id}/finaliser` — assemble et vérifie l'intégrité. Le contrat ne nomme
 *  pas explicitement le type de réponse ; le dossier mis à jour (`ReponseDossierReprise`) est la
 *  forme la plus naturelle pour cette transition d'état — à confirmer contre l'implémentation
 *  réelle du module API (écrit en parallèle) lors de l'assemblage. */
export async function finaliserDepot(
  dossierId: string,
  entree: EntreeFinalisationDepotReprise,
): Promise<ReponseDossierReprise> {
  const reponse = await requeteApi<ReponseDossierReprise>(`${RACINE}/${dossierId}/finaliser`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST finaliser.');
  }
  return reponse;
}

/** `POST /reprise/dossiers/{id}/analyses` — lance ou relance l'analyse (relance SANS redéposer
 *  l'archive, `analyse_echouee -> analyse_en_cours`). */
export async function lancerAnalyse(dossierId: string): Promise<ReponseAnalyseReprise> {
  const reponse = await requeteApi<ReponseAnalyseReprise>(`${RACINE}/${dossierId}/analyses`, {
    method: 'POST',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST analyses.');
  }
  return reponse;
}

/** `GET /reprise/dossiers/{id}/analyse` — résultat courant, singleton. */
export async function recupererAnalyse(dossierId: string): Promise<ReponseAnalyseReprise> {
  const reponse = await requeteApi<ReponseAnalyseReprise>(`${RACINE}/${dossierId}/analyse`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : GET analyse.');
  }
  return reponse;
}

/** `GET /reprise/dossiers/{id}/plan` — singleton, généré automatiquement en fin d'analyse. */
export async function recupererPlan(dossierId: string): Promise<ReponsePlanReprise> {
  const reponse = await requeteApi<ReponsePlanReprise>(`${RACINE}/${dossierId}/plan`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : GET plan.');
  }
  return reponse;
}

/** `PATCH /reprise/dossiers/{id}/plan` — LE seul ajustement possible (inclure/exclure des
 *  domaines en bloc). */
export async function modifierPlan(
  dossierId: string,
  entree: EntreeModificationPlanReprise,
): Promise<ReponsePlanReprise> {
  const reponse = await requeteApi<ReponsePlanReprise>(`${RACINE}/${dossierId}/plan`, {
    method: 'PATCH',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH plan.');
  }
  return reponse;
}

/** `POST /reprise/dossiers/{id}/plan/valider` — LA validation humaine unique. `Idempotency-Key`
 *  obligatoire (lance l'import, opération sensible). Corps `{}` (`schemaValidationPlanReprise`). */
export async function validerPlan(
  dossierId: string,
  idempotencyKey: string,
): Promise<ReponsePlanReprise> {
  const reponse = await requeteApi<ReponsePlanReprise>(`${RACINE}/${dossierId}/plan/valider`, {
    method: 'POST',
    body: JSON.stringify({}),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST plan/valider.');
  }
  return reponse;
}

/** `GET /reprise/dossiers/{id}/import` — suivi d'avancement, singleton. */
export async function recupererImport(dossierId: string): Promise<ReponseImportReprise> {
  const reponse = await requeteApi<ReponseImportReprise>(`${RACINE}/${dossierId}/import`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : GET import.');
  }
  return reponse;
}

/** `POST /reprise/dossiers/{id}/import/rejouer` — reprise après `import_echoue`, sans doublon
 *  (`AncrageOrigineReprise`). Pas d'`Idempotency-Key` (transition gardée par l'état de départ). */
export async function rejouerImport(
  dossierId: string,
  entree?: EntreeRejouerImportReprise,
): Promise<ReponseImportReprise> {
  const reponse = await requeteApi<ReponseImportReprise>(`${RACINE}/${dossierId}/import/rejouer`, {
    method: 'POST',
    body: JSON.stringify(entree ?? {}),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST import/rejouer.');
  }
  return reponse;
}

/** `GET /reprise/dossiers/{id}/rapport` — lisible dès que l'import a démarré. */
export async function recupererRapport(dossierId: string): Promise<RapportImportReprise> {
  const reponse = await requeteApi<RapportImportReprise>(`${RACINE}/${dossierId}/rapport`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : GET rapport.');
  }
  return reponse;
}

/** `POST /reprise/dossiers/{id}/annuler` — geste volontaire, motif requis. */
export async function annulerDossier(
  dossierId: string,
  entree: EntreeAnnulationDossierReprise,
): Promise<ReponseDossierReprise> {
  const reponse = await requeteApi<ReponseDossierReprise>(`${RACINE}/${dossierId}/annuler`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST annuler.');
  }
  return reponse;
}

/** `GET /reprise/dossiers` — collection triée `creeLe:desc` par défaut. `limite=1` suffit à
 *  obtenir le dossier « actif » (voir `useDossierRepriseActif`) : un tenant a normalement au plus
 *  un dossier non terminal à la fois, et le plus récent prime en cas d'historique. */
export async function listerDossiers(limite = 1): Promise<PageDossierReprise> {
  const parametres = new URLSearchParams({ limite: String(limite), tri: 'creeLe:desc' });
  const reponse = await requeteApi<PageDossierReprise>(`${RACINE}?${parametres.toString()}`, {
    method: 'GET',
  });
  return reponse ?? { donnees: [], curseurSuivant: null, limite };
}
