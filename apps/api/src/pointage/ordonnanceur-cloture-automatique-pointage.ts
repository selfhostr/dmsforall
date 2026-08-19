import type { OnApplicationBootstrap } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { JETON_CONFIG } from '../config';

import {
  clotureAutomatiquePointageJobDoitEtreActif,
  type ConfigAvecJobClotureAutomatiquePointage,
} from './config-job-cloture-automatique-pointage';
import {
  ID_JOB_CLOTURE_AUTOMATIQUE_POINTAGE,
  NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE,
  NOM_JOB_CLOTURE_AUTOMATIQUE_POINTAGE,
} from './cloture-automatique-pointage.jetons';

const journal = new Logger('OrdonnanceurClotureAutomatiquePointage');

/**
 * Déclenchement quotidien du job de clôture automatique de fin de journée du pointage (RM-91/
 * RM-119) — même patron que `vehicules/referentiel/referentiel-vehicules-ch-job.module.ts`
 * (modèle désigné par la consigne de ce chantier), à UNE différence structurelle délibérée :
 * un `@Injectable() implements OnApplicationBootstrap` **provider**, posé directement dans
 * `pointage.module.ts` (`providers`), plutôt qu'un second `@Module` séparé porteur du hook.
 *
 * POURQUOI CETTE DÉVIATION DU MODÈLE ASTRA — deux raisons, toutes deux liées au périmètre
 * d'écriture EXCLUSIF de cet agent :
 *   1. `ProcesseurClotureAutomatiquePointage` a besoin d'injecter `ServiceJobClotureAutomatique-
 *      Pointage`, qui a lui-même besoin de `ServiceClotureAutomatiquePointage` — un provider posé
 *      par `PointageModule` (`pointage.module.ts`), pas exporté vers un module SÉPARÉ sans créer
 *      une dépendance circulaire de modules (`PointageModule` importerait un `PointageJobModule`
 *      qui importerait en retour `PointageModule` pour cette même injection) ;
 *   2. un second `@Module` séparé devrait être enregistré explicitement dans `app.module.ts`
 *      (comme `ReferentielVehiculesChJobModule` l'est) — fichier HORS du périmètre d'écriture
 *      exclusif de cet agent. En posant ce déclencheur comme un PROVIDER ORDINAIRE de
 *      `PointageModule` (déjà enregistré dans `app.module.ts`, voir son en-tête), Nest invoque son
 *      `onApplicationBootstrap()` automatiquement — AUCUNE modification d'`app.module.ts` requise.
 *
 * `BullModule.registerQueue({ name: NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE })` (posé dans les
 * `imports` de `pointage.module.ts`) récupère automatiquement la connexion Redis posée par
 * `OrdonnancementModule` (`BullModule.forRootAsync`, monté une seule fois à la racine de l'app,
 * voir `ordonnancement/ordonnancement.module.ts`) — aucune configuration de connexion à répéter
 * ici, ni import explicite d'`OrdonnancementModule` (même constat que `ReferentielVehiculesChJob-
 * Module`, qui ne l'importe pas non plus : `BullModule.forRootAsync` rend sa configuration
 * disponible module-wide dès qu'elle est posée une fois dans le graphe applicatif).
 *
 * `Queue.upsertJobScheduler` — c'est LUI, pas un verrou applicatif maison, qui garantit qu'un seul
 * déclenchement a lieu par tick même avec PLUSIEURS instances d'API : le planificateur vit dans
 * REDIS, pas dans le process. `attempts`/`backoff` posés ICI (absents du modèle ASTRA, qui gère
 * ses échecs par un mécanisme différent — état persisté `echec`/`echecs_consecutifs`, jamais un
 * throw) : un échec de CE job (ex. `DATABASE_URL_MIGRATION` momentanément injoignable) doit
 * pouvoir être RETENTÉ dans la même nuit plutôt que d'attendre le lendemain, ce qui est sûr
 * PRÉCISÉMENT parce que l'opération entière est idempotente (voir `service-cloture-automatique-
 * pointage.ts` et `orchestration-job-cloture-automatique-pointage.ts`) — un retry ne referme
 * jamais un pointage déjà refermé, ni ne le referme deux fois.
 */
@Injectable()
export class OrdonnanceurClotureAutomatiquePointage implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE) private readonly file: Queue,
    @Inject(JETON_CONFIG) private readonly config: ConfigAvecJobClotureAutomatiquePointage,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!clotureAutomatiquePointageJobDoitEtreActif(this.config)) {
      journal.log(
        'Job de clôture automatique de fin de journée du pointage désactivé ' +
          `(NODE_ENV=${this.config.NODE_ENV}, POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF=` +
          `${this.config.POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF ?? 'non posée'}) — aucune programmation BullMQ.`,
      );
      return;
    }

    // `upsertJobScheduler` — idempotent par construction : un redémarrage de l'API (donc un
    // second appel à `onApplicationBootstrap` avec le même `ID_JOB_CLOTURE_AUTOMATIQUE_POINTAGE`)
    // met à jour le planificateur existant dans Redis au lieu d'en créer un second qui
    // doublerait les déclenchements quotidiens.
    await this.file.upsertJobScheduler(
      ID_JOB_CLOTURE_AUTOMATIQUE_POINTAGE,
      { pattern: this.config.POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON },
      {
        name: NOM_JOB_CLOTURE_AUTOMATIQUE_POINTAGE,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5 * 60_000 },
        },
      },
    );
    journal.log(
      'Job de clôture automatique de fin de journée du pointage programmé ' +
        `(cron « ${this.config.POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON} », UTC).`,
    );
  }
}
