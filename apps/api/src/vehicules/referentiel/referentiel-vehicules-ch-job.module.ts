import type { OnApplicationBootstrap } from '@nestjs/common';
import { Inject, Logger, Module } from '@nestjs/common';
import { BullModule, InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { JETON_CONFIG } from '../../config';

import {
  referentielVehiculesChJobDoitEtreActif,
  type ConfigAvecJobReferentielVehiculesCh,
} from './config-job-referentiel-vehicules-ch';
import { ProcesseurReferentielVehiculesCh } from './processeur-referentiel-vehicules-ch';
import {
  ID_JOB_REFERENTIEL_VEHICULES_CH,
  NOM_FILE_REFERENTIEL_VEHICULES_CH,
  NOM_JOB_REFERENTIEL_VEHICULES_CH,
} from './referentiel-vehicules-ch.jetons';
import { ServiceJobReferentielVehiculesCh } from './service-job-referentiel-vehicules-ch';

const journal = new Logger('ReferentielVehiculesChJobModule');

/**
 * Déclenchement quotidien du job de contrôle/import ASTRA (voir `job-mise-a-jour-referentiel-
 * vehicules-ch.ts` pour l'orchestration, `../../ordonnancement/` pour le socle BullMQ et le choix
 * d'architecture).
 *
 * `BullModule.registerQueue` récupère automatiquement la connexion Redis posée par
 * `OrdonnancementModule` (`BullModule.forRootAsync`, monté une seule fois à la racine de l'app —
 * voir `app.module.ts`) : aucune configuration de connexion à répéter ici.
 *
 * INTERRUPTEUR — `referentielVehiculesChJobDoitEtreActif` (voir `config-job-referentiel-
 * vehicules-ch.ts`, seul point de décision) : actif par défaut en PRODUCTION (oublier de poser
 * la variable ne doit plus jamais laisser le référentiel se périmer en silence — c'est le défaut
 * qui a coûté la panne du 17.08.2026), inactif par défaut ailleurs (`pnpm dev` sans variable
 * n'engage aucun appel vers `opendata.astra.admin.ch`). La variable reste un forçage EXPLICITE
 * dans les deux sens (activer sur un poste de dev pour tester, couper en production en cas
 * d'incident chez l'ASTRA).
 */
@Module({
  imports: [BullModule.registerQueue({ name: NOM_FILE_REFERENTIEL_VEHICULES_CH })],
  providers: [ServiceJobReferentielVehiculesCh, ProcesseurReferentielVehiculesCh],
})
export class ReferentielVehiculesChJobModule implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(NOM_FILE_REFERENTIEL_VEHICULES_CH) private readonly file: Queue,
    @Inject(JETON_CONFIG) private readonly config: ConfigAvecJobReferentielVehiculesCh,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!referentielVehiculesChJobDoitEtreActif(this.config)) {
      journal.log(
        'Job de contrôle/import du référentiel véhicules ASTRA désactivé ' +
          `(NODE_ENV=${this.config.NODE_ENV}, REFERENTIEL_VEHICULES_CH_JOB_ACTIF=` +
          `${this.config.REFERENTIEL_VEHICULES_CH_JOB_ACTIF ?? 'non posée'}) — aucune programmation BullMQ.`,
      );
      return;
    }

    // `upsertJobScheduler` — idempotent par construction : un redémarrage de l'API (donc un
    // second appel à `onApplicationBootstrap` avec le même `ID_JOB_REFERENTIEL_VEHICULES_CH`) met
    // à jour le planificateur existant dans Redis au lieu d'en créer un second qui doublerait les
    // déclenchements quotidiens.
    await this.file.upsertJobScheduler(
      ID_JOB_REFERENTIEL_VEHICULES_CH,
      { pattern: this.config.REFERENTIEL_VEHICULES_CH_JOB_CRON },
      { name: NOM_JOB_REFERENTIEL_VEHICULES_CH },
    );
    journal.log(
      `Job de contrôle/import du référentiel véhicules ASTRA programmé ` +
        `(cron « ${this.config.REFERENTIEL_VEHICULES_CH_JOB_CRON} », UTC).`,
    );
  }
}
