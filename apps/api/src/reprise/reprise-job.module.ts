import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';

import { type ConfigAvecModeProcessus, modeIncluTraitementFilesAttente } from '../ordonnancement';

import { ProcesseurAnalyseReprise } from './analyse/processeur-analyse-reprise';
import { ProcesseurImportReprise } from './import/processeur-import-reprise';
import { RepriseModule } from './reprise.module';

/**
 * Branchement CONSOMMATEUR des deux files de reprise (`reprise-analyse`, `reprise-import`) —
 * EXTRAIT de `reprise.module.ts` le 27.08.2026 (chantier « découplage worker/API ») pour pouvoir
 * le rendre CONDITIONNEL au rôle du process (`MODE_PROCESSUS`, voir `ordonnancement/mode-
 * processus.ts`), sans faire varier `RepriseModule` lui-même (voir son en-tête, § risque de
 * double-instanciation par appels `.pourConfig` distincts — `CycleVieTenantModule` l'importe
 * AUSSI, en forme statique).
 *
 * VIDE EN MODE 'api' : ni `ProcesseurAnalyseReprise` ni `ProcesseurImportReprise` (les deux
 * `@Processor`/`WorkerHost`, donc les deux `Worker` BullMQ réels) ne sont alors nulle part dans le
 * graphe Nest — exigence 1 du chantier. Les DEUX files elles-mêmes (`BullModule.registerQueue`)
 * restent posées par `RepriseModule`, INCONDITIONNELLEMENT, dans tous les modes — voir son
 * en-tête : ce sont des producteurs HTTP (`queue.add`), pas des consommateurs, et
 * `BullExplorer.getQueueOptions` (`@nestjs/bullmq`) les retrouve de toute façon par recherche
 * GLOBALE (`moduleRef.get(token, { strict: false })`) — ce module n'a donc PAS besoin de sa
 * propre copie de `BullModule.registerQueue` pour que ses deux processeurs démarrent
 * correctement leur `Worker` une fois en mode worker/combiné.
 *
 * Importé UNE SEULE FOIS, depuis `app.module.ts` — jamais depuis `reprise.module.ts` lui-même.
 *
 * `RepriseModule` importé ici en forme STATIQUE (classe nue) : `ServiceAnalyseReprise`/
 * `ServiceImportReprise` (désormais exportés par `RepriseModule`, voir son en-tête) sont les
 * SEULES dépendances métier des deux processeurs (`JETON_DB`, le reste de leur constructeur, est
 * global — `db/db.module.ts`).
 */
@Module({})
export class RepriseJobModule {
  static pourConfig(config: ConfigAvecModeProcessus): DynamicModule {
    if (!modeIncluTraitementFilesAttente(config)) {
      return { module: RepriseJobModule };
    }

    return {
      module: RepriseJobModule,
      imports: [RepriseModule],
      providers: [ProcesseurAnalyseReprise, ProcesseurImportReprise],
    };
  }
}
