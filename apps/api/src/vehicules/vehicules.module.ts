import { Module } from '@nestjs/common';

import { ServiceVehicule } from './service-vehicule';
import { ServiceVehiculeCampagne } from './service-vehicule-campagne';
import { ServiceVehiculeDetention } from './service-vehicule-detention';
import { ServiceVehiculeExpertise } from './service-vehicule-expertise';
import { ServiceVehiculeKilometrage } from './service-vehicule-kilometrage';
import { ServiceVehiculePlaque } from './service-vehicule-plaque';
import { ServiceVehiculeTravailReporte } from './service-vehicule-travail-reporte';
import { VehiculeController } from './vehicule.controller';
import { VehiculeDetentionController } from './vehicule-detention.controller';
import { VehiculeExpertiseController } from './vehicule-expertise.controller';
import { VehiculeKilometrageController } from './vehicule-kilometrage.controller';
import { VehiculePlaqueController } from './vehicule-plaque.controller';

/**
 * `ServiceVehiculeCampagne` et `ServiceVehiculeTravailReporte` n'ont, comme `clients/`, aucun
 * contrôleur qui les appelle au lot 1 (aucune route `campagnes`/`travaux-reportes` publiée) —
 * déclarés ici quand même pour que l'injection soit prête le jour où ce contrôleur existera,
 * et pour que ce module reste la source de vérité de tout ce que `apps/api/src/vehicules/**`
 * fournit, pas seulement ce qui est déjà exposé en HTTP.
 */
@Module({
  controllers: [
    VehiculeController,
    VehiculeDetentionController,
    VehiculeExpertiseController,
    VehiculeKilometrageController,
    VehiculePlaqueController,
  ],
  providers: [
    ServiceVehicule,
    ServiceVehiculeCampagne,
    ServiceVehiculeDetention,
    ServiceVehiculeExpertise,
    ServiceVehiculeKilometrage,
    ServiceVehiculePlaque,
    ServiceVehiculeTravailReporte,
  ],
})
export class VehiculesModule {}
