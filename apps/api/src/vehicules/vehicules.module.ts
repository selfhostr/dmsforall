import { Module } from '@nestjs/common';

import { ReferentielVehiculesChController } from './referentiel/referentiel-vehicules-ch.controller';
import { ReferentielVehiculesChJobModule } from './referentiel/referentiel-vehicules-ch-job.module';
import { ServiceReferentielVehiculesCh } from './referentiel/service-referentiel-vehicules-ch';
import { VehiculeOcrModule } from './ocr/vehicule-ocr.module';
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
import { VehiculeTravailReporteController } from './vehicule-travail-reporte.controller';

/**
 * `ServiceVehiculeCampagne` n'a, comme `clients/`, aucun contrôleur qui appelle SES méthodes
 * d'ÉCRITURE (aucune route `POST/PATCH campagnes` publiée) — déclaré ici quand même pour que
 * l'injection soit prête le jour où ce contrôleur existera. Ses DONNÉES sont déjà lisibles en HTTP
 * via `GET :vehiculeId/contexte-atelier` (`ServiceVehiculeContexteAtelier`), qui projette les
 * campagnes ouvertes via les fonctions de requête PARTAGÉES de `vehicule-requetes.ts` — pas via
 * cette classe de service elle-même.
 *
 * `ServiceVehiculeTravailReporte`, en revanche, a désormais SON contrôleur
 * (`VehiculeTravailReporteController`, `GET`/`PATCH .../travaux-reportes`) : lecture ET édition
 * (correction libre, clôture `repris`, abandon `abandonne`, RM-73) sont exposées en HTTP. La
 * CRÉATION reste, elle, sans route HTTP directe — un travail reporté naît d'un refus de ligne d'OR
 * (`atelier`, hors périmètre de ce module), via le port `CreationTravailReporte` que
 * `ServiceVehiculeTravailReporte` implémente désormais (voir `service-vehicule-travail-reporte.ts`
 * et la réponse de tâche pour le câblage exact attendu côté `atelier`) — c'est la raison pour
 * laquelle ce service est maintenant EXPORTÉ ci-dessous : `AtelierModule` devra l'importer pour
 * lier son futur jeton `JETON_CREATION_TRAVAIL_REPORTE` à cette instance (`useExisting`).
 */
@Module({
  imports: [
    // Job quotidien de contrôle/import du référentiel véhicules ASTRA — file BullMQ +
    // planification, voir `referentiel/referentiel-vehicules-ch-job.module.ts`. Dépend de
    // `OrdonnancementModule` (connexion BullMQ partagée) monté à la racine de l'app
    // (`app.module.ts`), jamais réimporté ici.
    ReferentielVehiculesChJobModule,
    // Scan OCR du permis de circulation — module autonome (`ocr/vehicule-ocr.module.ts`),
    // importé ici pour que son contrôleur soit réellement monté (un contrôleur non déclaré dans
    // un `@Module` donne un 404 silencieux, piège documenté de ce dépôt).
    VehiculeOcrModule,
  ],
  controllers: [
    VehiculeController,
    VehiculeDetentionController,
    VehiculeExpertiseController,
    VehiculeKilometrageController,
    VehiculePlaqueController,
    VehiculeTravailReporteController,
    ReferentielVehiculesChController,
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
    ServiceReferentielVehiculesCh,
  ],
  exports: [ServiceVehiculeTravailReporte],
})
export class VehiculesModule {}
