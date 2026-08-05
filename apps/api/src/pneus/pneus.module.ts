import { Module } from '@nestjs/common';

import {
  DepotPneusController,
  SiteHangarPneusController,
  VehiculeDepotsPneusController,
} from './depot-pneus.controller';
import { ServiceDepotPneus } from './service-depot-pneus';

/**
 * Module hangar à pneus (`docs/specification-parc-et-hangar-pneus.md`, Lot A). Droits posés
 * définitivement (`pneus.depot.lire`/`.creer`/`.changer_saison`/`.sortir`, `auth/matrice-droits.ts`)
 * via `@ExigerDroit(...)` + `GardeDroit` sur `depot-pneus.controller.ts`.
 *
 * `JETON_DB`/`JETON_IDEMPOTENCE` sont fournis par `DbModule`/`CommonModule` (tous deux
 * `@Global`, voir `app.module.ts`) : aucun des deux n'est importé ici, même précédent que
 * `PiecesModule`/`ClientsModule`.
 */
@Module({
  controllers: [SiteHangarPneusController, VehiculeDepotsPneusController, DepotPneusController],
  providers: [ServiceDepotPneus],
  exports: [ServiceDepotPneus],
})
export class PneusModule {}
