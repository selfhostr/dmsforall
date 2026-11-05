/**
 * Cycle de vie de sortie du garage d'un tenant (offboarding) : export intégral
 * remis au garage, conservation limitée, effacement final avec trace d'audit.
 *
 * Domaine de contrats DÉLIBÉRÉMENT distinct de `contrats/exploitation/` (console d'exploitation,
 * PORTE 1) : `contrats/exploitation/index.ts` déclare explicitement « la PORTE 2 (entrer dans un
 * garage, lire ses données métier) n'a volontairement AUCUN contrat ici… conditionnée à des
 * prérequis contractuels nLPD non tranchés ». Ce cycle de vie touche PAR NATURE les données
 * métier d'un tenant choisi par un opérateur — exactement le périmètre que ce commentaire réserve.
 * Le séparer dans son propre domaine évite de contredire silencieusement cette déclaration écrite.
 * Voir le rapport de livraison de la migration 0062 pour le désaccord signalé, non tranché ici.
 *
 * Miroir exact de `public.statut_resiliation_tenant` (migration 0062, apps/api/src/db/migrations/
 * 0062_cycle_vie_resiliation_tenant.sql) — machine à états LOCALE à cette migration, PAS le
 * dispositif partagé `entite_auditee`/`transition_autorisee` (voir §A de son en-tête).
 */

export const STATUTS_RESILIATION_TENANT = [
  'demandee',
  'export_en_cours',
  'export_echoue',
  'export_pret',
  'export_remis',
  'en_conservation',
  'efface',
] as const;
export type StatutResiliationTenant = (typeof STATUTS_RESILIATION_TENANT)[number];

/** États TERMINAUX : aucune transition n'en part. */
export const STATUTS_RESILIATION_TENANT_TERMINAUX: readonly StatutResiliationTenant[] = ['efface'];
