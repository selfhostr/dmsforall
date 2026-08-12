import { Module } from '@nestjs/common';

import { AtelierModule } from '../atelier.module';

import { ImpressionOrController } from './impression-or.controller';
import { ServiceImpressionOr } from './service-impression-or';

/**
 * Façade HTTP de l'impression d'OR (`GET /ordres-reparation/{orId}/pdf`).
 *
 * `imports: [AtelierModule]` — PAS l'inverse, même raisonnement que
 * `facturation/impression/impression.module.ts` important `FacturationModule` : `ServiceOr`
 * (nécessaire à `ServiceImpressionOr`) est un provider direct d'`AtelierModule`, exporté par lui
 * (`atelier.module.ts`, `exports: [ServiceOr, ...]`). Si `AtelierModule` importait
 * `ImpressionOrModule` en retour, on créerait un cycle de modules — sens unique respecté ici.
 *
 * Câblé dans `apps/api/src/app.module.ts` (`imports: []`, aux côtés d'`AtelierModule`) — périmètre
 * d'écriture étendu explicitement à ce fichier par le coordinateur. Piège du dépôt vérifié :
 * un module complet jamais importé par un module racine compile et passe ses tests sans exposer
 * la moindre route (`GET /api/docs.json` prouve la route réellement exposée, voir le rapport).
 */
@Module({
  imports: [AtelierModule],
  controllers: [ImpressionOrController],
  providers: [ServiceImpressionOr],
  exports: [ServiceImpressionOr],
})
export class ImpressionOrModule {}
