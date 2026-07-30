import { Module } from '@nestjs/common';

import { ExportComptableController } from './export-comptable.controller';
import { JETON_EXPORTEUR_WINBIZ } from './export.jetons';
import { ServiceExportComptable } from './service-export-comptable';
import { WinbizExporteurService } from './winbiz';

/**
 * Module du domaine « export fiduciaire » (`docs/exports-fiduciaires.md`).
 *
 * **État à cette livraison** :
 *  - `WinbizExporteurService` (`winbiz/`) : adaptateur pur (calcul, aucun accès base/réseau),
 *    inchangé, propriété du lot WinBIZ.
 *  - `ServiceExportComptable` (`service-export-comptable.ts`) : orchestration — sélectionne les
 *    documents émis non exportés d'une période, construit les écritures (`ecritures/`), résout le
 *    plan comptable (`mapping/`), vérifie la continuité de numérotation (`continuite/`), appelle
 *    `WinbizExporteurService`, écrit `export_comptable` et marque `document_vente.exporte_le`/
 *    `export_id`.
 *  - `ExportComptableController` (`export-comptable.controller.ts`) : `POST /exports-fiduciaires`,
 *    câblé DEPUIS CE LOT. Le blocage qui empêchait ce contrôleur d'exister — l'action
 *    `facturation.export.creer` absente de `TOUTES_ACTIONS`/`MATRICE_DROITS`
 *    (`apps/api/src/auth/matrice-droits.ts`) — a été levé par le propriétaire d'`auth/` :
 *    l'action existe désormais, accordée à `direction`/`comptable` UNIQUEMENT (`admin: []`, RF-115
 *    — voir `DROITS_EXPORT_COMPTABLE_PAR_ROLE` dans `matrice-droits.ts`). `controllers:
 *    [ExportComptableController]` ci-dessous CLÔT le test structurel `common/droits/toutes-les-
 *    actions-couvertes.spec.ts`, qui signalait `facturation.export.creer` comme une action de la
 *    matrice sans aucune route pour la porter.
 */
@Module({
  providers: [
    WinbizExporteurService,
    { provide: JETON_EXPORTEUR_WINBIZ, useExisting: WinbizExporteurService },
    ServiceExportComptable,
  ],
  controllers: [ExportComptableController],
  exports: [WinbizExporteurService, JETON_EXPORTEUR_WINBIZ, ServiceExportComptable],
})
export class ExportModule {}
