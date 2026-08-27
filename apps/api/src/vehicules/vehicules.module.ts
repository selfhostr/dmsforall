import { Module } from '@nestjs/common';

import { ReferentielVehiculesChController } from './referentiel/referentiel-vehicules-ch.controller';
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
    // Le job quotidien de contrôle/import du référentiel véhicules ASTRA (`referentiel/
    // referentiel-vehicules-ch-job.module.ts`) N'EST PLUS importé ici depuis le 27.08.2026
    // (chantier « découplage worker/API ») : ce module dynamique a besoin du rôle du process
    // (`MODE_PROCESSUS`) pour décider s'il s'enregistre — indisponible à ce niveau (les imports
    // d'un `@Module` statique s'évaluent au chargement du fichier, avant toute config). Enregistré
    // désormais directement par `app.module.ts` (`ReferentielVehiculesChJobModule.pourConfig
    // (config)`), à côté de `VehiculesModule` plutôt qu'imbriqué dedans — voir son en-tête.
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
