import { Module } from '@nestjs/common';

import { EtatDemarrageController } from './etat-demarrage.controller';
import { ServiceEtatDemarrage } from './service-etat-demarrage';

/** Accueil — état de mise en route du garage (`GET /accueil/etat-demarrage`). */
@Module({
  controllers: [EtatDemarrageController],
  providers: [ServiceEtatDemarrage],
})
export class AccueilModule {}
