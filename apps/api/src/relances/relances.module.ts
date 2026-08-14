import { Module } from '@nestjs/common';

import { ConnecteursModule } from '../connecteurs/connecteurs.module';

import { RelancesController } from './relances.controller';
import { ServiceHistoriqueEnvoisRelance } from './service-historique-envois';
import { ServiceRegleRelance } from './service-regle-relance';
import { ServiceRelancesFacture } from './service-relances-facture';

/**
 * Module relances automatiques — LOT 1 (facturation, rappel #2,
 * `docs/specification-relances-automatiques.md`) + historique d'envoi (issue #136). Droits posés
 * définitivement (`relances.facturation.regle.lire`/`.ecrire`/`.planifier`/`.envoyer`,
 * `auth/matrice-droits.ts`) via `@ExigerDroit(...)` + `GardeDroit` sur `relances.controller.ts` —
 * `GET .../historique` réutilise `relances.facturation.regle.lire` (voir la doc d'en-tête de
 * `relances.controller.ts` pour l'arbitrage).
 *
 * `ConnecteursModule` IMPORTÉ explicitement : contrairement à `JETON_DB`/`Horloge`/`ServiceJournal`
 * (fournis par des modules `@Global`, voir `app.module.ts`), `RegistreConnecteursService` ne l'est
 * pas — `ServiceRelancesFacture` en a besoin pour résoudre l'adaptateur `NotificationSender`.
 */
@Module({
  imports: [ConnecteursModule],
  controllers: [RelancesController],
  providers: [ServiceRegleRelance, ServiceRelancesFacture, ServiceHistoriqueEnvoisRelance],
  exports: [ServiceRegleRelance, ServiceRelancesFacture, ServiceHistoriqueEnvoisRelance],
})
export class RelancesModule {}
