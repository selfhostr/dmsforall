/**
 * Noms BullMQ du job quotidien de clôture automatique de fin de journée du pointage (RM-91/
 * RM-119) — même patron que `vehicules/referentiel/referentiel-vehicules-ch.jetons.ts` (modèle).
 */
export const NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE = 'pointage-cloture-automatique';
export const NOM_JOB_CLOTURE_AUTOMATIQUE_POINTAGE = 'clore-fin-de-journee';
/** Identifiant du "job scheduler" BullMQ (`Queue.upsertJobScheduler`) — stable entre deux
 *  redémarrages : un ID différent créerait un second planificateur au lieu de mettre à jour
 *  celui déjà enregistré dans Redis. */
export const ID_JOB_CLOTURE_AUTOMATIQUE_POINTAGE = 'pointage-cloture-automatique-quotidien';
