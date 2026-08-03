import { Module } from '@nestjs/common';

import { DossierVenteController } from './dossier-vente.controller';
import { FinancementController } from './financement.controller';
import { RepriseController } from './reprise.controller';
import { ServiceDossierVente } from './service-dossier-vente';
import { ServiceFinancement } from './service-financement';
import { ServiceReprise } from './service-reprise';
import { ServiceVehiculeStock } from './service-vehicule-stock';
import { VehiculeStockController } from './vehicule-stock.controller';
import { VehiculesStockController } from './vehicules-stock.controller';

/**
 * Module ventes VN/VO (étape 4) : véhicule en stock (priorité 1), dossier de vente (priorité 2),
 * reprise et financement (priorité 3) — `docs/specification-etape-4-ventes.md`.
 *
 * `JETON_DB`/`JETON_IDEMPOTENCE`/`JETON_AUDIT` sont fournis par `DbModule`/`CommonModule` (tous
 * deux `@Global`, voir `app.module.ts`) : aucun des deux n'est importé ici, même précédent que
 * `ClientsModule`/`PiecesModule`.
 */
@Module({
  controllers: [VehiculeStockController, VehiculesStockController, DossierVenteController, RepriseController, FinancementController],
  providers: [ServiceVehiculeStock, ServiceDossierVente, ServiceReprise, ServiceFinancement],
  exports: [ServiceVehiculeStock, ServiceDossierVente, ServiceReprise, ServiceFinancement],
})
export class VentesModule {}
