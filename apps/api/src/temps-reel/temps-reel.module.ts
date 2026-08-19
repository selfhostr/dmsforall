import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import {
  providerRedisAbonneTempsReel,
  providerRedisPublieurTempsReel,
} from './redis-temps-reel.provider';
import { RegistreAbonnesTempsReel } from './registre-abonnes-temps-reel';
import { ServiceEvenementsTempsReel } from './service-evenements-temps-reel';
import { TempsReelController } from './temps-reel.controller';

/**
 * Canal d'événements temps réel — socle générique (voir `service-evenements-temps-reel.ts`).
 *
 * `imports: [AuthModule]` : le contrôleur SSE a besoin de `JETON_SERVICE_SESSION` (revalider la
 * session pendant que le flux reste ouvert, voir `temps-reel.controller.ts`), exporté par
 * `AuthModule`. Sens unique : `AuthModule` n'importe jamais ce module, aucun cycle.
 *
 * `exports: [ServiceEvenementsTempsReel]` — c'est TOUT ce qu'un module métier consommateur a
 * besoin d'injecter pour publier un événement ; `RegistreAbonnesTempsReel` et les connexions Redis
 * restent des détails internes.
 */
@Module({
  imports: [AuthModule],
  controllers: [TempsReelController],
  providers: [
    providerRedisPublieurTempsReel,
    providerRedisAbonneTempsReel,
    RegistreAbonnesTempsReel,
    ServiceEvenementsTempsReel,
  ],
  exports: [ServiceEvenementsTempsReel],
})
export class TempsReelModule {}
