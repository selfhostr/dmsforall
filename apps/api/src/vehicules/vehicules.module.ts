import { Module } from '@nestjs/common';

import { ServiceVehicule } from './service-vehicule';
import { ServiceVehiculeCampagne } from './service-vehicule-campagne';
import { ServiceVehiculeContexteAtelier } from './service-vehicule-contexte-atelier';
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
 * contrôleur qui appelle LEURS MÉTHODES (CRUD) au lot 1 (aucune route `POST/PATCH campagnes` ou
 * `PATCH travaux-reportes` publiée) — déclarés ici quand même pour que l'injection soit prête le
 * jour où ces contrôleurs existeront, et pour que ce module reste la source de vérité de tout ce
 * que `apps/api/src/vehicules/**` fournit, pas seulement ce qui est déjà exposé en HTTP.
 *
 * Leurs DONNÉES, elles, sont déjà lisibles en HTTP : `GET :vehiculeId/contexte-atelier`
 * (`ServiceVehiculeContexteAtelier`) projette les campagnes ouvertes et les travaux reportés via
 * les fonctions de requête PARTAGÉES de `vehicule-requetes.ts` (et, pour les travaux reportés,
 * via `versReponseTravailReporte`, exporté par `ServiceVehiculeTravailReporte`) — pas via ces
 * classes de service elles-mêmes, qui restent réservées à leurs futurs endpoints d'écriture/liste.
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
    ServiceVehiculeContexteAtelier,
    ServiceVehiculeDetention,
    ServiceVehiculeExpertise,
    ServiceVehiculeKilometrage,
    ServiceVehiculePlaque,
    ServiceVehiculeTravailReporte,
  ],
})
export class VehiculesModule {}
