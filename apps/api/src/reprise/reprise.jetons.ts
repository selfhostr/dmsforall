import type { WorkerOptions } from 'bullmq';

/**
 * Jetons d'injection et constantes BullMQ du module reprise — même doctrine que
 * `exploitation/cycle-vie-tenant/cycle-vie-tenant.jetons.ts` : noms de file en constantes
 * partagées entre le déclencheur (`Queue.add`) et le `@Processor`, jamais une chaîne dupliquée.
 */

export const NOM_FILE_ANALYSE_REPRISE = 'reprise-analyse';
export const NOM_JOB_ANALYSE_REPRISE = 'analyser-dossier-reprise';

export const NOM_FILE_IMPORT_REPRISE = 'reprise-import';
export const NOM_JOB_IMPORT_REPRISE = 'importer-dossier-reprise';

/**
 * Options worker BullMQ partagées par les DEUX processeurs de reprise (`ProcesseurAnalyseReprise`,
 * `ProcesseurImportReprise` — « même patron », voir leur en-tête) : aucun réglage central
 * `@nestjs/bullmq` ne permet de poser un défaut de WORKER (`lockDuration`/`concurrency`) pour
 * toutes les files enregistrées via `forRootAsync` (vérifié sur les types `BullRootModuleOptions`
 * / `RegisterQueueOptions` — ils n'étendent que `QueueOptions`, jamais `WorkerOptions`) : une seule
 * constante PARTAGÉE ENTRE LES DEUX `@Processor` de ce module est le meilleur substitut disponible,
 * plutôt que de dupliquer les mêmes magic numbers dans chaque fichier.
 *
 * DÉFAUT RÉEL (26.08.2026) — aucun `@Processor` du dépôt (les six existants, vérifié)
 * ne posait `lockDuration`/`concurrency` : la valeur par défaut de BullMQ (`lockDuration` 30s,
 * renouvellement automatique à 15s) suffit pour un job court, mais s'est avérée fragile pour
 * l'analyse d'une archive de reprise (mesurée à ~7,5 min sur 2,39 Go, bien plus sur les 43,5 Go
 * réels attendus) : le VRAI correctif est la cession régulière de l'event loop dans la boucle de
 * profilage (`common/concurrence/ceder-controle-event-loop.ts`), qui restaure le renouvellement
 * AUTOMATIQUE de verrou de BullMQ (`Worker.lockRenewTime`) — PAS un appel manuel à
 * `Job.extendLock` (qui existe, mais souffre de la MÊME famine que le renouvellement automatique :
 * les deux sont des minuteurs, la cession de l'event loop les débloque tous les deux à la fois,
 * un appel manuel n'aurait rien réglé de plus). Ce qui suit n'est que le FILET, pas le correctif :
 *
 *   - `lockDuration` : 2 minutes — très généreux comparé au budget de cession (20 ms, voir
 *     `SEUIL_CESSION_EVENT_LOOP_MS_DEFAUT`) et à la marge d'exécution réelle d'un `setImmediate`
 *     sous charge (quelques dizaines de ms mesurées, jamais des secondes), mais reste BORNÉ : un
 *     worker réellement mort (SIGKILL, OOM — le seul cas que la cession ne peut pas couvrir) libère
 *     le job pour un autre worker en 2 minutes maximum, pas indéfiniment. `stalledInterval` reste
 *     au défaut BullMQ (30s) — inchangé, aucune raison mesurée de le repousser.
 *   - `concurrency` : 1 — un seul job de reprise à la fois PAR PROCESSUS worker. Le goulot mesuré
 *     est le disque/sous-processus (`mdb-export`), pas le nombre de jobs en vol : en paralléliser
 *     deux sur le même processus ajouterait de la pression mémoire/E-S sans bénéfice, et
 *     prolongerait le temps de garde des deux jobs actifs à la fois.
 *
 * Les quatre autres processeurs du dépôt (export résiliation, purge automatique tenant, clôture
 * pointage, référentiel véhicules ASTRA) ne reçoivent PAS ces réglages ici : mesuré (lecture de
 * leur code), aucun n'itère sur un flux local/sous-processus volumineux comme `lecteurs/` — leur
 * travail est borné par des allers-retours Postgres/HTTP, de vrais points d'attente asynchrones
 * qui ne souffrent pas du mécanisme de famine mesuré ici. Les leur poser sans preuve du même
 * défaut serait deviner, pas corriger — reste à réévaluer si l'un d'eux grossit un jour au point
 * de itérer, lui aussi, sur un flux local volumineux.
 */
export const OPTIONS_WORKER_REPRISE: Partial<WorkerOptions> = {
  lockDuration: 2 * 60 * 1000,
  concurrency: 1,
};

/** Port de stockage des tranches/archive binaire — voir `depot/stockage-archive-reprise.ts`. */
export const JETON_STOCKAGE_ARCHIVE_REPRISE = Symbol('JETON_STOCKAGE_ARCHIVE_REPRISE');

/**
 * Port de lecture de l'archive source (famille de moteur, tables, lecture en flux, copie faisant
 * foi, rôle métier déduit) — implémenté par `apps/api/src/reprise/lecteurs/` (autre agent, EN
 * COURS au moment où ce module est écrit). Codé contre ce port, jamais contre l'implémentation
 * concrète : voir `lecture/port-lecteur-archive-reprise.ts` pour l'interface exacte et la
 * justification de ce découplage.
 */
export const JETON_LECTEUR_ARCHIVE_REPRISE = Symbol('JETON_LECTEUR_ARCHIVE_REPRISE');
