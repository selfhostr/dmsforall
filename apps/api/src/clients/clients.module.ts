import { Module } from '@nestjs/common';

import {
  ClientAdresseController,
  ClientConditionController,
  ClientConsentementController,
  ClientContactController,
  ClientNoteController,
} from './client-sous-collections.controller';
import { ClientOrdresReparationController, ClientVehiculesController } from './client-projections.controller';
import { ClientController } from './client.controller';
import { DoublonsClientsController } from './doublons-clients.controller';
import { ServiceClient } from './service-client';
import { ServiceClientOrdresReparation } from './service-client-ordres-reparation';
import { ServiceClientSousCollections } from './service-client-sous-collections';
import { ServiceClientVehicules } from './service-client-vehicules';

/**
 * Couche HTTP du domaine clients (contrat gelé désormais disponible, `@dfa/shared`,
 * `contrats-api-etape-1.md` §7.3 — le blocage documenté dans une version antérieure de ce fichier
 * n'a plus lieu d'être). Six contrôleurs, chacun sur son périmètre disjoint de routes :
 *
 *  - `ClientController` : CRUD cœur de la fiche (`/clients`, `/clients/{id}`, désactivation).
 *  - `DoublonsClientsController` : `/doublons-clients`, à la RACINE (RM-05).
 *  - `ClientAdresseController` / `ClientContactController` / `ClientConditionController` /
 *    `ClientConsentementController` / `ClientNoteController` : sous-collections de la fiche.
 *  - `ClientVehiculesController` / `ClientOrdresReparationController` : projections en lecture
 *    seule (véhicules détenus, OR du client).
 *
 * `JETON_COMPTEURS` (`ServiceClient`) est fourni par `CompteursModule` (`@Global`, importé depuis
 * `ParametrageModule`), donc résolu sans import explicite ici — voir `app.module.ts`.
 */
@Module({
  controllers: [
    ClientController,
    DoublonsClientsController,
    ClientAdresseController,
    ClientContactController,
    ClientConditionController,
    ClientConsentementController,
    ClientNoteController,
    ClientVehiculesController,
    ClientOrdresReparationController,
  ],
  providers: [ServiceClient, ServiceClientOrdresReparation, ServiceClientSousCollections, ServiceClientVehicules],
  exports: [ServiceClient, ServiceClientOrdresReparation, ServiceClientSousCollections, ServiceClientVehicules],
})
export class ClientsModule {}
