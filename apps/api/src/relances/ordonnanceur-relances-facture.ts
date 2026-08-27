import type { OnApplicationBootstrap } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { JETON_CONFIG } from '../config';

import { relancesFactureJobDoitEtreActif, type ConfigAvecJobRelances } from './config-job-relances';
import {
  ID_JOB_RELANCES_FACTURE,
  NOM_FILE_RELANCES_FACTURE,
  NOM_JOB_RELANCES_FACTURE,
} from './relances.jetons';

const journal = new Logger('OrdonnanceurRelancesFacture');

/**
 * Déclenchement horaire des relances de facturation (rappel #2) — MÊME PATRON que
 * `pointage/ordonnanceur-cloture-automatique-pointage.ts` (modèle désigné, voir son en-tête pour
 * le détail complet des choix repris tels quels : `Queue.upsertJobScheduler` plutôt qu'un verrou
 * applicatif — le planificateur vit dans REDIS, correct même avec plusieurs instances API ;
 * `attempts`/`backoff` propres à CE déclenchement).
 *
 * PROVIDER ORDINAIRE de `RelancesJobModule` (jamais posé sur la classe du module lui-même) — un
 * module Nest instancie TOUJOURS sa propre classe, même quand le `DynamicModule` qu'il rend est
 * vide (`injector/module.js::addModuleRef`, `@nestjs/core`) : garder `@InjectQueue`/
 * `OnApplicationBootstrap` sur `RelancesJobModule` ferait planter le démarrage en mode 'api' pur,
 * la file n'étant alors pas déclarée dans la branche vide de `.pourConfig` — voir
 * `relances-job.module.ts`.
 */
@Injectable()
export class OrdonnanceurRelancesFacture implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(NOM_FILE_RELANCES_FACTURE) private readonly file: Queue,
    @Inject(JETON_CONFIG) private readonly config: ConfigAvecJobRelances,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!relancesFactureJobDoitEtreActif(this.config)) {
      journal.log(
        'Job de relances de facturation désactivé ' +
          `(NODE_ENV=${this.config.NODE_ENV}, RELANCES_FACTURE_JOB_ACTIF=` +
          `${this.config.RELANCES_FACTURE_JOB_ACTIF ?? 'non posée'}) — aucune programmation BullMQ.`,
      );
      return;
    }

    // `upsertJobScheduler` — idempotent par construction : un redémarrage de l'API (donc un
    // second appel à `onApplicationBootstrap` avec le même `ID_JOB_RELANCES_FACTURE`) met à jour
    // le planificateur existant dans Redis au lieu d'en créer un second qui doublerait les
    // déclenchements horaires.
    await this.file.upsertJobScheduler(
      ID_JOB_RELANCES_FACTURE,
      { pattern: this.config.RELANCES_FACTURE_JOB_CRON },
      {
        name: NOM_JOB_RELANCES_FACTURE,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5 * 60_000 },
        },
      },
    );
    journal.log(
      `Job de relances de facturation programmé (cron « ${this.config.RELANCES_FACTURE_JOB_CRON} », UTC).`,
    );
  }
}
