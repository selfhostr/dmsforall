import { Module } from '@nestjs/common';

import { TempsReelModule } from '../../temps-reel';
import { ClientMoteurOcrHttp, JETON_CLIENT_MOTEUR_OCR } from './client-moteur-ocr';
import { ServiceVehiculeOcr } from './service-vehicule-ocr';
import { VehiculeOcrController } from './vehicule-ocr.controller';

/**
 * Scan OCR du permis de circulation. `TempsReelModule` importé pour `ServiceEvenementsTempsReel`
 * (notification poste fixe quand un client est déjà identifié, voir `service-vehicule-ocr.ts`) —
 * `JETON_DB`/`JETON_SERVICE_LIMITATION_DEBIT`/`JETON_CONFIG` viennent de modules `@Global()`
 * (`DbModule`, `LimitationModule`, `ConfigModule`), jamais réimportés ici.
 */
@Module({
  imports: [TempsReelModule],
  controllers: [VehiculeOcrController],
  providers: [
    ServiceVehiculeOcr,
    { provide: JETON_CLIENT_MOTEUR_OCR, useClass: ClientMoteurOcrHttp },
  ],
})
export class VehiculeOcrModule {}
