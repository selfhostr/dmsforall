import type { OnApplicationBootstrap } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { JETON_CONFIG } from '../../config';

import {
  referentielVehiculesChJobDoitEtreActif,
  type ConfigAvecJobReferentielVehiculesCh,
} from './config-job-referentiel-vehicules-ch';
import {
  ID_JOB_REFERENTIEL_VEHICULES_CH,
  NOM_FILE_REFERENTIEL_VEHICULES_CH,
  NOM_JOB_REFERENTIEL_VEHICULES_CH,
} from './referentiel-vehicules-ch.jetons';

const journal = new Logger('OrdonnanceurReferentielVehiculesCh');

/**
 * EXTRAIT le 27.08.2026 (chantier « découplage worker/API ») du CORPS de la classe
 * `ReferentielVehiculesChJobModule` elle-même, où cette logique vivait jusqu'ici (constructeur +
 * `OnApplicationBootstrap` posés directement sur le module) — voir l'en-tête de
 * `referentiel-vehicules-ch-job.module.ts` pour pourquoi ce déplacement était nécessaire (pas
 * seulement une préférence de style) : un module Nest exécute TOUJOURS son propre constructeur
 * dès qu'il apparaît dans le graphe, même quand le `DynamicModule` qu'il rend est vide — le rendre
 * conditionnel en mode 'api' aurait donc fait planter `@InjectQueue` (plus aucune file enregistrée
 * dans la branche vide) plutôt que de simplement ne rien programmer. Devenu un provider ORDINAIRE,
 * ce risque disparaît : ce fichier n'est même pas RÉFÉRENCÉ dans le graphe en mode 'api'.
 *
 * Comportement INCHANGÉ par rapport à l'original — voir `job-mise-a-jour-referentiel-vehicules-
 * ch.ts`/`ordonnancement/ordonnancement.module.ts` pour le choix d'architecture (BullMQ,
 * `Queue.upsertJobScheduler`) et `config-job-referentiel-vehicules-ch.ts` pour l'interrupteur
 * (`REFERENTIEL_VEHICULES_CH_JOB_ACTIF`).
 */
@Injectable()
export class OrdonnanceurReferentielVehiculesCh implements OnApplicationBootstrap {
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

    // `upsertJobScheduler` — idempotent par construction : un redémarrage du worker (donc un
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
