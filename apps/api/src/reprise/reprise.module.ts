import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { raw } from 'express';

import { AnalyseRepriseController } from './analyse/analyse.controller';
import { ProcesseurAnalyseReprise } from './analyse/processeur-analyse-reprise';
import { ServiceAnalyseReprise } from './analyse/service-analyse-reprise';
import { StockageArchiveRepriseDisqueLocal } from './depot/stockage-archive-reprise';
import { ServiceDepotReprise } from './depot/service-depot-reprise';
import { TrancheRepriseController } from './depot/tranche-reprise.controller';
import { DossierRepriseController } from './dossier-reprise.controller';
import { ProcesseurImportReprise } from './import/processeur-import-reprise';
import { ImportRepriseController } from './import/import.controller';
import { ServiceImportReprise } from './import/service-import-reprise';
import { AdaptateurLecteurArchiveReprise } from './lecture/adaptateur-lecteur-archive-reprise';
import { PlanRepriseController } from './plan/plan.controller';
import { ServicePlanReprise } from './plan/service-plan-reprise';
import {
  JETON_LECTEUR_ARCHIVE_REPRISE,
  JETON_STOCKAGE_ARCHIVE_REPRISE,
  NOM_FILE_ANALYSE_REPRISE,
  NOM_FILE_IMPORT_REPRISE,
} from './reprise.jetons';
import { ServiceCycleVieDossierReprise } from './service-cycle-vie-dossier-reprise';

/**
 * Reprise de données par dépôt d'archive (contrats/reprise.ts, migration 0067).
 *
 * `JETON_LECTEUR_ARCHIVE_REPRISE` : câblé sur `AdaptateurLecteurArchiveReprise` (adaptateur RÉEL,
 * `lecture/adaptateur-lecteur-archive-reprise.ts`, branché sur `lecteurs/` — voir son en-tête pour
 * la conversion de types à la frontière du port). `AdaptateurLecteurArchiveRepriseFactice`
 * (rejeu en mémoire) reste réservé aux tests unitaires du reste du module, jamais posé ici.
 *
 * Enregistré dans `app.module.ts` (voir son import de `RepriseModule`) — piège vérifié n°1 du
 * projet (contrôleur non déclaré = 404 silencieux) refermé par cet agent.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOM_FILE_ANALYSE_REPRISE }),
    BullModule.registerQueue({ name: NOM_FILE_IMPORT_REPRISE }),
  ],
  controllers: [
    DossierRepriseController,
    TrancheRepriseController,
    AnalyseRepriseController,
    PlanRepriseController,
    ImportRepriseController,
  ],
  providers: [
    ServiceCycleVieDossierReprise,
    ServiceDepotReprise,
    ServiceAnalyseReprise,
    ProcesseurAnalyseReprise,
    ServicePlanReprise,
    ServiceImportReprise,
    ProcesseurImportReprise,
    { provide: JETON_STOCKAGE_ARCHIVE_REPRISE, useClass: StockageArchiveRepriseDisqueLocal },
    { provide: JETON_LECTEUR_ARCHIVE_REPRISE, useClass: AdaptateurLecteurArchiveReprise },
  ],
  exports: [ServiceCycleVieDossierReprise],
})
export class RepriseModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // `PUT .../tranches/{numero}` porte un corps `application/octet-stream` SANS schéma zod (§
    // contrat) — `express.raw()` scopé au SEUL `TrancheRepriseController` (qui n'héberge QUE cette
    // route en écriture binaire ; `GET .../tranches` et `POST .../finaliser`, JSON, ne sont pas
    // affectés). Limite généreuse au-delà de `TAILLE_TRANCHE_RECOMMANDEE_OCTETS_DEFAUT` (16 Mo) :
    // le serveur accepte toute taille de tranche raisonnable (doctrine du contrat), jamais une
    // limite imposée au client.
    consumer
      .apply(raw({ type: 'application/octet-stream', limit: '128mb' }))
      .forRoutes(TrancheRepriseController);
  }
}
