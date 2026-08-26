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
 *   - `lockDuration` : 30 minutes (RÉVISÉ le 26.08.2026, mesuré — voir plus bas ; 2 minutes
 *     jusque-là). Le calcul d'origine ("très généreux comparé au budget de cession de 20 ms")
 *     était juste EN ISOLATION mais ratait un enchaînement mesuré le jour même : un job dont le
 *     verrou expire à tort N'EST PAS INTERROMPU — sa Promise JS continue de tourner, orpheline,
 *     BullMQ se contentant de la réassigner à un second worker (voir plus haut, § « pas
 *     interrompue »). Cet orphelin partage la MÊME boucle d'événements Node que TOUT AUTRE job en
 *     cours, y compris d'une AUTRE file de reprise (`concurrency: 1` est PAR PROCESSEUR, pas
 *     global au processus). Résultat mesuré en production ce jour : l'orphelin affame assez la
 *     boucle pour retarder de plusieurs minutes le prochain `tx.execute` d'une transaction PAR
 *     AILLEURS irréprochable — assez pour dépasser `idle_in_transaction_session_timeout`
 *     (`db/acces-base.service.ts`), PostgreSQL tue la connexion, et SANS l'écouteur `error` posé
 *     à la connexion (même chantier, même fichier) l'erreur remontait en `uncaughtException`
 *     PROCESS-WIDE — tout le produit hors service pour l'échec d'un seul job de reprise d'un seul
 *     garage. Un `lockDuration` mal dimensionné n'est donc pas ici un simple confort : c'est le
 *     PREMIER maillon de cette chaîne — il CRÉE l'orphelin qui affame tout le reste. Durées
 *     réelles observées le 26.08.2026 sur l'archive complète de @laupernoe (552 tables, 2,3 Go) :
 *     analyse 11 min 41 à 19 min 50 ; import 5 min 24 à 29 min 13 (le plus long, rejeu idempotent
 *     contre ~16 800 lignes déjà en base). 30 minutes couvre le pire cas mesuré (29 min 13) avec
 *     une marge réelle (~54 %, comparable à la croissance déjà observée du nombre de tables
 *     détectées sur cette même archive après un correctif distinct), tout en restant BORNÉ : un
 *     worker réellement mort (SIGKILL, OOM — le seul cas qu'aucune cession ne peut couvrir) libère
 *     le job pour un autre worker en 30 minutes maximum, pas indéfiniment. `stalledInterval` reste
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
  lockDuration: 30 * 60 * 1000,
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
