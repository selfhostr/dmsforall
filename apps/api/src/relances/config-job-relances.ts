import { z } from 'zod';

/**
 * Configuration du job périodique de relances de facturation (rappel #2,
 * `docs/specification-relances-automatiques.md`) — MÊME DOCTRINE que
 * `pointage/config-job-cloture-automatique-pointage.ts` (modèle) : interrupteur TRISTATE, jamais
 * un booléen à défaut fixe — un défaut « désactivé partout » reproduirait exactement le trou
 * documenté par `service-relances-facture.ts` (§ en-tête : « aucun ordonnanceur n'existe dans ce
 * dépôt ») tant que personne ne pense à activer la variable en production. Actif par défaut en
 * PRODUCTION, inactif ailleurs, forçage EXPLICITE dans les deux sens.
 *
 * Fusionnée dans `schemaConfig` par `apps/api/src/config/charger-config.ts` via
 * `...schemaConfigJobRelances.shape` — POINT DE CONTACT hors du périmètre d'écriture exclusif de
 * cet agent (`config/` n'y figure pas), signalé explicitement dans le rapport de livraison, même
 * geste déjà accepté pour les trois autres bundles de job (ASTRA, clôture pointage, purge
 * automatique tenant). Sans cette fusion, les deux variables ci-dessous sont silencieusement
 * `undefined` au runtime même posées dans `.env` — le job reste alors inactif en toute
 * circonstance (fail-closed, jamais un envoi accidentel par défaut de câblage).
 */
export const schemaConfigJobRelances = z.object({
  /**
   * Interrupteur EXPLICITE, TRISTATE (voir l'en-tête de fichier pour le sens du défaut).
   * `undefined` (variable absente ou vide) laisse `relancesFactureJobDoitEtreActif` DÉCIDER selon
   * `NODE_ENV`. `'true'`/`'false'` EXPLICITES forcent dans les deux sens, quel que soit `NODE_ENV`.
   */
  RELANCES_FACTURE_JOB_ACTIF: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['true', 'false']).optional(),
  ),
  /**
   * Expression cron (5 champs, BullMQ — fuseau UTC). Défaut `12 * * * *` — TOUTES LES HEURES, à
   * la 12ᵉ minute (décalée des autres jobs nocturnes du dépôt, ASTRA `17 4 * * *`, pointage
   * `30 0 * * *`, purge `17 3 * * *` — jamais une heure ronde, pour ne jamais les faire coïncider
   * sur le même pool `DATABASE_POOL_MAX`, partagé par tous les tenants).
   *
   * CADENCE HORAIRE, PAS QUOTIDIENNE — différence délibérée avec les trois autres jobs du dépôt
   * (tous quotidiens) : `planifier()` calcule des paliers exprimés en JOURS (`regle_relance.
   * delaisJours`, §4) — une exécution quotidienne suffirait à ne RATER aucun palier. Mais
   * `envoyerPretes()` est le chemin qui fait réellement partir un rappel de facture impayée vers
   * un client — un rappel dont le déclenchement dépend d'un cron qui ne passe qu'une fois par nuit
   * ferait attendre jusqu'à 24h un client déjà en retard, sans aucun bénéfice (les deux méthodes
   * sont des lots BORNÉS et idempotents, `LOT_PLANIFICATION`/`LOT_ENVOI` dans
   * `service-relances-facture.ts` — un passage horaire coûte le même ordre de grandeur de requêtes
   * qu'un passage quotidien, juste réparti sur 24 occasions au lieu d'une). Le choix retenu ici
   * fait donc passer les DEUX opérations ensemble, à la cadence qu'exige la plus exigeante des
   * deux (l'envoi), plutôt que deux crons séparés à deux cadences — voir `relances.jetons.ts` pour
   * pourquoi une seule file suffit.
   */
  RELANCES_FACTURE_JOB_CRON: z.string().min(1).default('12 * * * *'),
});

/**
 * Forme MINIMALE de `Config` nécessaire à ce module — structurelle, volontairement PAS
 * `Pick<Config, …>` (même raison que `ConfigAvecJobClotureAutomatiquePointage` : importer `Config`
 * depuis `charger-config.ts` créerait un cycle).
 */
export interface ConfigAvecJobRelances {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly RELANCES_FACTURE_JOB_ACTIF: 'true' | 'false' | undefined;
  readonly RELANCES_FACTURE_JOB_CRON: string;
  /** Rôle `dfa_migrator` — seul canal utilisé par ce job pour énumérer les tenants actifs (voir
   *  `enumerer-tenants-actifs-relances.ts`), jamais `DATABASE_URL`/`AccesBase`. */
  readonly DATABASE_URL_MIGRATION: string;
}

/**
 * SEUL point de décision entre job actif/inactif — même patron que
 * `clotureAutomatiquePointageJobDoitEtreActif` (`pointage/config-job-cloture-automatique-
 * pointage.ts`), même sens de défaut (risque ici aussi l'OUBLI — un garage qui ne relance jamais
 * ses factures en retard — pas l'envoi accidentel) :
 *
 *   - variable EXPLICITE (`'true'`/`'false'`) -> elle gagne, quel que soit `NODE_ENV` ;
 *   - variable ABSENTE -> actif SEULEMENT en production, inactif en `development`/`test`.
 */
export function relancesFactureJobDoitEtreActif(config: ConfigAvecJobRelances): boolean {
  if (config.RELANCES_FACTURE_JOB_ACTIF !== undefined) {
    return config.RELANCES_FACTURE_JOB_ACTIF === 'true';
  }
  return config.NODE_ENV === 'production';
}
