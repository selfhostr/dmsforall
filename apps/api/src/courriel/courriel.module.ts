import { Module } from '@nestjs/common';
import { providerTransportCourriel } from './provider-transport-courriel';
import { FabriqueTransportSmtp } from './fabrique-transport-smtp';
import { ServiceCourriel } from './service-courriel';
import { ServiceReglageEnvoiCourriel } from './service-reglage-envoi-courriel';

/**
 * Capacité d'envoi de courriel — SOCLE SEUL (aucun branchement métier, voir
 * `service-courriel.ts` : ni relances, ni envoi de facture, ni invitation d'utilisateur — ces
 * usages viendront plus tard, par d'autres modules qui injecteront `ServiceCourriel`).
 *
 * Toujours monté, contrairement à `ExploitationModule` : ce qui varie selon la config n'est
 * jamais la PRÉSENCE de ce module, mais le TRANSPORT choisi en interne (réel ou capture) — voir
 * `provider-transport-courriel.ts`. Pas de `pourConfig` nécessaire : le provider lit
 * `JETON_CONFIG`, déjà global (fourni par `ConfigModule.pourRacine`, `AppModule`).
 */
@Module({
  providers: [
    providerTransportCourriel,
    FabriqueTransportSmtp,
    ServiceReglageEnvoiCourriel,
    ServiceCourriel,
  ],
  exports: [ServiceCourriel, ServiceReglageEnvoiCourriel],
})
export class CourrielModule {}
