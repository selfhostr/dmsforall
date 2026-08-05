import { Module } from '@nestjs/common';

import { ConnecteursModule } from '../connecteurs/connecteurs.module';

import { RelancesController } from './relances.controller';
import { ServiceRegleRelance } from './service-regle-relance';
import { ServiceRelancesFacture } from './service-relances-facture';

/**
 * Module relances automatiques — LOT 1 (facturation, rappel #2,
 * `docs/specification-relances-automatiques.md`). Droits posés PROVISOIREMENT (voir
 * `droits-provisoires.ts` — `apps/api/src/auth/matrice-droits.ts` hors périmètre de cet agent).
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
