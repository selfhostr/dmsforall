import { z } from 'zod';

/**
 * Configuration du job quotidien de contrôle/import du référentiel véhicules suisse ASTRA
 * (`type_approbation_ch`, 0050) — voir `job-mise-a-jour-referentiel-vehicules-ch.ts`.
 *
 * Fusionnée dans `schemaConfig` par `apps/api/src/config/charger-config.ts` via
 * `...schemaConfigJobReferentielVehiculesCh.shape` — même patron que `schemaConfigCourriel`
 * (`courriel/config-courriel.ts`) et `schemaConfigConsole` (`exploitation/config-console.ts`) :
 * une seule source de vérité sur le schéma, jamais une redéclaration séparée qui pourrait
 * diverger.
 */
export const schemaConfigJobReferentielVehiculesCh = z.object({
  /**
   * Interrupteur EXPLICITE, mais TRISTATE — PAS un booléen à défaut fixe comme
   * `COURRIEL_ENVOI_REEL` (`courriel/config-courriel.ts`). Correction du 17.08.2026 (@laupernoe) : un
   * défaut « désactivé partout » recrée EXACTEMENT le défaut qu'on corrige — en production, si
   * personne ne pense à poser la variable, le job ne tourne jamais et le référentiel se périme en
   * silence (le scénario du `docker:reset` qui a coûté cette panne). Un défaut sûr est « actif là
   * où c'est nécessaire, désactif là où c'est nuisible », pas « désactivé partout ».
   *
   * `undefined` (variable absente ou vide) laisse `referentielVehiculesChJobDoitEtreActif`
   * DÉCIDER selon `NODE_ENV` — actif par défaut en production, inactif par défaut ailleurs.
   * `'true'`/`'false'` EXPLICITES forcent dans les deux sens, quel que soit `NODE_ENV` : un poste
   * de dev peut activer le job pour le tester, la production peut le couper en cas d'incident
   * chez `opendata.astra.admin.ch` — voir cette fonction, seul point de décision.
   */
  REFERENTIEL_VEHICULES_CH_JOB_ACTIF: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.enum(['true', 'false']).optional(),
  ),
  /**
   * Expression cron (5 champs, `node-cron`/BullMQ — fuseau UTC, jamais l'heure locale du
   * conteneur) du passage quotidien. Défaut `17 4 * * *` (04h17 UTC) : hors heures d'ouverture
   * des garages suisses (l'ASTRA republie ses exports TAS en fin de nuit/tôt le matin, source
   * généralement stable à cette heure), et une minute décalée de l'heure ronde pour ne pas
   * cogner une éventuelle tâche de maintenance externe programmée pile à `04:00`.
   */
  REFERENTIEL_VEHICULES_CH_JOB_CRON: z.string().min(1).default('17 4 * * *'),
});

/**
 * Forme MINIMALE de `Config` nécessaire à ce module — structurelle, volontairement PAS
 * `Pick<Config, …>` : importer `Config` depuis `charger-config.ts` créerait un cycle, puisque
 * `charger-config.ts` importe ce fichier pour fusionner son schéma (même raison que
 * `ConfigAvecCourriel`/`ConfigAvecConsole`).
 */
export interface ConfigAvecJobReferentielVehiculesCh {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly REFERENTIEL_VEHICULES_CH_JOB_ACTIF: 'true' | 'false' | undefined;
  readonly REFERENTIEL_VEHICULES_CH_JOB_CRON: string;
  readonly DATABASE_URL_MIGRATION: string;
}

/**
 * SEUL point de décision entre job actif/inactif — jamais un test `NODE_ENV`/`ACTIF` dispersé
 * ailleurs (même patron que `courrielDoitEnvoyerReellement`, `courriel/config-courriel.ts`, en
 * inversant le SENS du défaut : là-bas le risque est l'envoi accidentel — défaut fermé partout ;
 * ici le risque est l'OUBLI — défaut ouvert en production, fermé ailleurs).
 *
 *   - variable EXPLICITE (`'true'`/`'false'`) -> elle gagne, quel que soit `NODE_ENV` ;
 *   - variable ABSENTE -> actif SEULEMENT en production, inactif en `development`/`test`.
 *
 * Un `pnpm dev` sans la variable reste donc silencieux vers `opendata.astra.admin.ch` (comme
 * avant), MAIS un déploiement de production sans la variable programme désormais le job — c'est
 * le changement voulu : plus possible d'oublier de l'activer, seulement possible de la couper
 * explicitement.
 */
export function referentielVehiculesChJobDoitEtreActif(
  config: ConfigAvecJobReferentielVehiculesCh,
): boolean {
  if (config.REFERENTIEL_VEHICULES_CH_JOB_ACTIF !== undefined) {
    return config.REFERENTIEL_VEHICULES_CH_JOB_ACTIF === 'true';
  }
  return config.NODE_ENV === 'production';
}
