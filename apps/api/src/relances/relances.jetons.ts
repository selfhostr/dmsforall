/**
 * Noms/identifiants BullMQ du job périodique de relances de facturation (rappel #2,
 * `docs/specification-relances-automatiques.md`) — même patron que
 * `pointage/cloture-automatique-pointage.jetons.ts` (modèle). `service-relances-facture.ts`
 * (§ en-tête, « CE QUI RESTE À FAIRE ») documentait déjà l'absence d'un tel déclencheur ; ce
 * fichier pose les constantes câblées par `relances-job.module.ts`.
 */

/** Une SEULE file : `planifier()` et `envoyerPretes()` sont invoquées l'une après l'autre, pour
 *  CHAQUE tenant, dans le même passage — voir `orchestration-job-relances.ts`. Pas de file
 *  distincte par opération : les deux méthodes partagent le même rythme et la même unité de
 *  travail (« un tenant »), contrairement à `cycle-vie-tenant` où purge planifiée et export à la
 *  demande sont deux besoins réellement indépendants (voir `cycle-vie-tenant.jetons.ts`). */
export const NOM_FILE_RELANCES_FACTURE = 'relances-facture';
export const NOM_JOB_RELANCES_FACTURE = 'planifier-et-envoyer';
/** Identifiant du "job scheduler" BullMQ (`Queue.upsertJobScheduler`) — stable entre deux
 *  redémarrages : un ID différent créerait un second planificateur au lieu de mettre à jour
 *  celui déjà enregistré dans Redis. */
export const ID_JOB_RELANCES_FACTURE = 'relances-facture-horaire';
