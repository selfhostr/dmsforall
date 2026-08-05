import { Module } from '@nestjs/common';

import { ConnecteursModule } from '../connecteurs/connecteurs.module';

import { RelancesController } from './relances.controller';
import { ServiceRegleRelance } from './service-regle-relance';
import { ServiceRelancesFacture } from './service-relances-facture';

/**
 * Module relances automatiques — LOT 1 (facturation, rappel #2,
 * `docs/specification-relances-automatiques.md`). Droits posés définitivement
 * (`relances.facturation.regle.lire`/`.ecrire`/`.planifier`/`.envoyer`, `auth/matrice-droits.ts`)
 * via `@ExigerDroit(...)` + `GardeDroit` sur `relances.controller.ts`.
 *
 * `ConnecteursModule` IMPORTÉ explicitement : contrairement à `JETON_DB`/`Horloge`/`ServiceJournal`
 * (fournis par des modules `@Global`, voir `app.module.ts`), `RegistreConnecteursService` ne l'est
 * pas — `ServiceRelancesFacture` en a besoin pour résoudre l'adaptateur `NotificationSender`.
 */
@Module({
  imports: [ConnecteursModule],
  controllers: [RelancesController],
  providers: [ServiceRegleRelance, ServiceRelancesFacture],
  exports: [ServiceRegleRelance, ServiceRelancesFacture],
})
export class RelancesModule {}
