import { Module } from '@nestjs/common';

import { CourtoisieController } from './courtoisie.controller';
import { ServiceCourtoisie } from './service-courtoisie';

/** Véhicules de courtoisie (prêt) : parc, disponibilité par période, prêts aux clients. */
@Module({
  controllers: [CourtoisieController],
  providers: [ServiceCourtoisie],
})
export class CourtoisieModule {}
