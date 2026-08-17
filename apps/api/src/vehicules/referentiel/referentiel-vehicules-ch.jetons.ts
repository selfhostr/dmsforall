/**
 * Noms BullMQ du job quotidien de contrôle/import du référentiel véhicules ASTRA — voir
 * `referentiel-vehicules-ch-job.module.ts`.
 */
export const NOM_FILE_REFERENTIEL_VEHICULES_CH = 'referentiel-vehicules-ch';
export const NOM_JOB_REFERENTIEL_VEHICULES_CH = 'controler-et-importer';
/** Identifiant du "job scheduler" BullMQ (`Queue.upsertJobScheduler`) — stable entre deux
 *  redémarrages : un ID différent créerait un second planificateur au lieu de mettre à jour
 *  celui déjà enregistré dans Redis. */
export const ID_JOB_REFERENTIEL_VEHICULES_CH = 'referentiel-vehicules-ch-quotidien';
