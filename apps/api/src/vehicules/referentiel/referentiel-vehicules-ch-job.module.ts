import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import {
  type ConfigAvecModeProcessus,
  modeIncluTraitementFilesAttente,
} from '../../ordonnancement';

import { OrdonnanceurReferentielVehiculesCh } from './ordonnanceur-referentiel-vehicules-ch';
import { ProcesseurReferentielVehiculesCh } from './processeur-referentiel-vehicules-ch';
import { NOM_FILE_REFERENTIEL_VEHICULES_CH } from './referentiel-vehicules-ch.jetons';
import { ServiceJobReferentielVehiculesCh } from './service-job-referentiel-vehicules-ch';

/**
 * Déclenchement quotidien du job de contrôle/import ASTRA (voir `job-mise-a-jour-referentiel-
 * vehicules-ch.ts` pour l'orchestration, `../../ordonnancement/` pour le socle BullMQ et le choix
 * d'architecture).
 *
 * REFACTORISÉ le 27.08.2026 (chantier « découplage worker/API ») en module DYNAMIQUE-SEUL
 * (`.pourConfig`), même patron que `pointage/pointage-cloture-automatique-job.module.ts`,
 * `reprise/reprise-job.module.ts` et `exploitation/cycle-vie-tenant/cycle-vie-tenant-job.module.ts`
 * (les quatre bundles de job du dépôt, tous convertis par ce même chantier).
 *
 * La logique de planification (`@InjectQueue` + `OnApplicationBootstrap`) vivait auparavant
 * DIRECTEMENT sur la classe de CE module — DÉPLACÉE dans un provider ORDINAIRE,
 * `OrdonnanceurReferentielVehiculesCh` (voir son en-tête pour le pourquoi : un module Nest
 * enregistre TOUJOURS sa propre classe comme provider et l'instancie donc systématiquement,
 * MÊME quand le `DynamicModule` qu'il rend est vide — `injector/module.js::addModuleRef`,
 * vérifié dans le code de `@nestjs/core` avant d'écrire ce commentaire — garder la logique sur la
 * classe du module aurait donc fait planter le démarrage en mode 'api' pur, `@InjectQueue` ne
 * résolvant plus rien une fois la file retirée de la branche vide ci-dessous).
 *
 * VIDE EN MODE 'api', ET C'EST UN MÉCANISME, PAS UNE INTENTION : `{ module:
 * ReferentielVehiculesChJobModule }` sans `imports`/`providers` ne pose NI la file BullMQ NI aucun
 * des trois providers — `ProcesseurReferentielVehiculesCh` (`@Processor`) n'est alors NULLE PART
 * dans le graphe Nest, donc jamais instancié, donc `BullExplorer.registerWorkers()` ne crée AUCUN
 * `Worker` pour cette file — exigence 1 du chantier (« pas seulement inactif : pas enregistré »).
 *
 * INTERRUPTEUR APPLICATIF INCHANGÉ — `referentielVehiculesChJobDoitEtreActif` (voir
 * `config-job-referentiel-vehicules-ch.ts`, lu par `OrdonnanceurReferentielVehiculesCh` désormais)
 * reste le SEUL point de décision entre job actif/inactif EN PLUS de ce gate-ci : les deux
 * interrupteurs sont indépendants et répondent à des questions différentes — celui-ci décide « ce
 * PROCESS traite-t-il des files BullMQ » (rôle du binaire), l'autre décide « le job ASTRA
 * lui-même doit-il tourner » (bascule métier/opérationnelle, ex. incident chez l'ASTRA). Un
 * process worker peut donc parfaitement enregistrer CE module (mode 'worker'/'combine') tout en
 * laissant `referentielVehiculesChJobDoitEtreActif` décider de ne rien planifier.
 *
 * Importé désormais directement par `app.module.ts` — PLUS par `vehicules.module.ts` (voir son
 * en-tête) : un seul point d'import, sans risque de double-instanciation par appels `.pourConfig`
 * distincts (voir `pointage/pointage-cloture-automatique-job.module.ts` pour le détail de ce
 * risque et pourquoi il ne s'applique qu'aux modules multi-importés).
 */
@Module({})
export class ReferentielVehiculesChJobModule {
  static pourConfig(config: ConfigAvecModeProcessus): DynamicModule {
    if (!modeIncluTraitementFilesAttente(config)) {
      return { module: ReferentielVehiculesChJobModule };
    }

    return {
      module: ReferentielVehiculesChJobModule,
      imports: [BullModule.registerQueue({ name: NOM_FILE_REFERENTIEL_VEHICULES_CH })],
      providers: [
        ServiceJobReferentielVehiculesCh,
        ProcesseurReferentielVehiculesCh,
        OrdonnanceurReferentielVehiculesCh,
      ],
    };
  }
}
