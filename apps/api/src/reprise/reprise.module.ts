import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { raw } from 'express';

import { AnalyseRepriseController } from './analyse/analyse.controller';
import { ServiceAnalyseReprise } from './analyse/service-analyse-reprise';
import { StockageArchiveRepriseDisqueLocal } from './depot/stockage-archive-reprise';
import { ServiceDepotReprise } from './depot/service-depot-reprise';
import { TrancheRepriseController } from './depot/tranche-reprise.controller';
import { DossierRepriseController } from './dossier-reprise.controller';
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
 * projet (contrôleur non déclaré = 404 silencieux) refermé par ce lot.
 *
 * `BullModule.registerQueue` pour LES DEUX files reste ici, INCONDITIONNEL (jamais gaté par
 * `MODE_PROCESSUS`) — chantier « découplage worker/API » (27.08.2026) : `ServiceAnalyseReprise`/
 * `ServiceImportReprise`/`ServicePlanReprise` sont des PRODUCTEURS (`@InjectQueue`, `queue.add(...)`
 * déclenché depuis `AnalyseRepriseController`/`ImportRepriseController`/`PlanRepriseController` —
 * un utilisateur qui lance une analyse ou un import HTTP doit pouvoir poser le job même quand ce
 * process tourne en mode 'api' pur, sans worker). Seuls les DEUX `@Processor`
 * (`ProcesseurAnalyseReprise`/`ProcesseurImportReprise`, les CONSOMMATEURS) ont déménagé dans
 * `reprise-job.module.ts`, un second `@Module` DYNAMIQUE enregistré séparément dans
 * `app.module.ts` — voir son en-tête pour le mécanisme complet et pourquoi `RepriseModule`
 * lui-même reste une classe statique inchangée (importée à la fois ici et par
 * `exploitation/cycle-vie-tenant/cycle-vie-tenant.module.ts` : le faire varier par mode aurait créé
 * une seconde instance de tout ce module côté `CycleVieTenantModule`, voir le même en-tête).
 *
 * `ServiceAnalyseReprise`/`ServiceImportReprise` désormais EXPORTÉS (ajout du même chantier) :
 * `reprise-job.module.ts` en a besoin pour construire `ProcesseurAnalyseReprise`/
 * `ProcesseurImportReprise`, qui vivent maintenant HORS de ce module.
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
    ServicePlanReprise,
    ServiceImportReprise,
    { provide: JETON_STOCKAGE_ARCHIVE_REPRISE, useClass: StockageArchiveRepriseDisqueLocal },
    { provide: JETON_LECTEUR_ARCHIVE_REPRISE, useClass: AdaptateurLecteurArchiveReprise },
  ],
  // `JETON_STOCKAGE_ARCHIVE_REPRISE` : exporté pour `CycleVieTenantModule` — la purge de
  // résiliation (`ServiceCycleVieResiliation.purger`, correctif nLPD) doit effacer les
  // archives binaires déposées sur disque pour le tenant, via CETTE MÊME abstraction (jamais un
  // accès disque en dur dans le service de résiliation). Voir `stockage-archive-reprise.ts`.
  // `ServiceAnalyseReprise`/`ServiceImportReprise` : exportés pour `reprise-job.module.ts` (voir
  // ci-dessus).
  exports: [
    ServiceCycleVieDossierReprise,
    JETON_STOCKAGE_ARCHIVE_REPRISE,
    ServiceAnalyseReprise,
    ServiceImportReprise,
  ],
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
