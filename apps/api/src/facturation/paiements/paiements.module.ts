import { Module } from '@nestjs/common';

import { PaiementController } from './paiement.controller';
import { ServicePaiement } from './service-paiement';

/**
 * Encaissement et lettrage (`RF-65` → `RF-80`, `MD-50` → `MD-57`) — module AUTONOME, pas encore
 * importé par un module racine `facturation`. `JETON_DB` et `JETON_IDEMPOTENCE` sont fournis par
 * `DbModule`/`CommonModule`, tous deux `@Global()` et déjà importés par `AppModule` (voir
 * `common/idempotence/idempotence.jetons.ts`) : ce module n'a donc besoin de fournir ni l'un ni
 * l'autre lui-même.
 *
 * À CÂBLER par l'orchestrateur : `imports: [PaiementsModule]` dans le futur
 * `facturation.module.ts` (racine `apps/api/src/facturation/`, hors périmètre de cet agent).
 *
 * `ServicePaiement` est exporté : `atelier`/`facturation/documents` en auront probablement besoin
 * plus tard (afficher le statut de règlement d'un OR, déclencher une émission bloquée par une
 * période comptable close) — décision d'usage laissée aux modules consommateurs, pas anticipée ici
 * par une interface supplémentaire.
 */
@Module({
  controllers: [PaiementController],
  providers: [ServicePaiement],
  exports: [ServicePaiement],
})
export class PaiementsModule {}
