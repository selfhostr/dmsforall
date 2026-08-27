import { Module } from '@nestjs/common';

import { ConnecteursModule } from '../connecteurs/connecteurs.module';
import { CourrielModule } from '../courriel/courriel.module';
import { ImpressionModule } from '../facturation/impression/impression.module';

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
 * pas — `ServiceRelancesFacture` en a besoin pour résoudre l'adaptateur `NotificationSender`
 * (canal SMS uniquement depuis l'issue #136, voir son en-tête).
 *
 * `CourrielModule` IMPORTÉ explicitement (issue #136) : le canal e-mail des relances de facture
 * n'attend plus un adaptateur `NotificationSender` — `RegistreConnecteursService.resoudre()` rend
 * TOUJOURS `null` aujourd'hui (`SourceActivationsConnecteurAucune`, voir l'en-tête de
 * `connecteurs.module.ts` : aucune table `connecteur_activation` n'existe), donc router l'e-mail
 * par ce chemin revenait à ne JAMAIS l'envoyer réellement. `ServiceRelancesFacture` consomme
 * directement `ServiceCourriel` (socle SMTP/capture déjà livré, `courriel/`) pour ce canal — voir
 * `service-relances-facture.ts`, section « email ».
 *
 * `ImpressionModule` IMPORTÉ explicitement (arbitrage du coordinateur sur la pièce jointe des
 * relances) : fournit `JETON_STOCKAGE_PDF` — `ServiceRelancesFacture` lit, EN LECTURE SEULE, le
 * PDF de facture déjà mis en cache sur disque par `ServiceImpressionFacture` (jamais de
 * régénération, ce job n'a pas de `PrincipalAuthentifie` pour faire valider RF-116 — voir le
 * constructeur de `ServiceRelancesFacture`). `ImpressionModule` importe lui-même
 * `FacturationModule` ; aucun cycle, `FacturationModule` n'importe jamais `RelancesModule`.
 */
@Module({
  imports: [ConnecteursModule, CourrielModule, ImpressionModule],
  controllers: [RelancesController],
  providers: [ServiceRegleRelance, ServiceRelancesFacture, ServiceHistoriqueEnvoisRelance],
  exports: [ServiceRegleRelance, ServiceRelancesFacture, ServiceHistoriqueEnvoisRelance],
})
export class RelancesModule {}
