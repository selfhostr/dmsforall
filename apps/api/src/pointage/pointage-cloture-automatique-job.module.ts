import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { type ConfigAvecModeProcessus, modeIncluTraitementFilesAttente } from '../ordonnancement';

import { NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE } from './cloture-automatique-pointage.jetons';
import { OrdonnanceurClotureAutomatiquePointage } from './ordonnanceur-cloture-automatique-pointage';
import { PointageModule } from './pointage.module';
import { ProcesseurClotureAutomatiquePointage } from './processeur-cloture-automatique-pointage';
import { ServiceJobClotureAutomatiquePointage } from './service-job-cloture-automatique-pointage';

/**
 * Branchement BullMQ de la clôture automatique de fin de journée du pointage (RM-91/RM-119) —
 * EXTRAIT de `pointage.module.ts` le 27.08.2026 (chantier « découplage worker/API ») pour pouvoir
 * le rendre CONDITIONNEL au rôle du process (`MODE_PROCESSUS`, voir `ordonnancement/mode-
 * processus.ts`), sans toucher au reste du module Pointage. Même patron que `vehicules/referentiel/
 * referentiel-vehicules-ch-job.module.ts` (modèle déjà en place pour l'ASTRA, suivi ici à
 * l'identique) : module DYNAMIQUE-SEUL, `.pourConfig(config)`, rendu vide en mode 'api'.
 *
 * VIDE EN MODE 'api', ET C'EST UN MÉCANISME, PAS UNE INTENTION : `{ module:
 * PointageClotureAutomatiqueJobModule }` sans `imports`/`providers` ne pose NI la file BullMQ NI
 * aucun des trois providers — `ProcesseurClotureAutomatiquePointage` (`@Processor`) n'est alors
 * NULLE PART dans le graphe Nest, donc jamais instancié, donc `BullExplorer.registerWorkers()`
 * (`@nestjs/bullmq`, appelé automatiquement au `onModuleInit` du socle BullMQ) ne crée AUCUN
 * `Worker` pour cette file — exigence 1 du chantier (« pas seulement inactif : pas enregistré »).
 *
 * Importé UNE SEULE FOIS, depuis `app.module.ts` — jamais depuis `pointage.module.ts` lui-même
 * (voir son en-tête, § risque de double-instanciation par appels `.pourConfig` distincts).
 *
 * `PointageModule` importé ici en forme STATIQUE (classe nue, jamais `.pourConfig(...)`) : Nest
 * déduplique par référence de classe, donc le fait qu'`atelier.module.ts` importe LUI AUSSI
 * `PointageModule` sous cette même forme statique ne crée pas de seconde instance — une seule
 * partagée, comme avant ce chantier. `ServiceClotureAutomatiquePointage` (déjà exporté par
 * `PointageModule`) est la SEULE chose consommée ici.
 */
@Module({})
export class PointageClotureAutomatiqueJobModule {
  static pourConfig(config: ConfigAvecModeProcessus): DynamicModule {
    if (!modeIncluTraitementFilesAttente(config)) {
      return { module: PointageClotureAutomatiqueJobModule };
    }

    return {
      module: PointageClotureAutomatiqueJobModule,
      imports: [
        PointageModule,
        BullModule.registerQueue({ name: NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE }),
      ],
      providers: [
        ServiceJobClotureAutomatiquePointage,
        ProcesseurClotureAutomatiquePointage,
        OrdonnanceurClotureAutomatiquePointage,
      ],
    };
  }
}
