import { Module } from '@nestjs/common';

import { ServiceClient } from './service-client';
import { ServiceClientOrdresReparation } from './service-client-ordres-reparation';
import { ServiceClientSousCollections } from './service-client-sous-collections';
import { ServiceClientVehicules } from './service-client-vehicules';

/**
 * AUCUN contrôleur : `apps/api/src/clients/**` ne contient, à ce jour, que la couche domaine
 * (services + mappers + règles), jamais de `@Controller`. Contrairement à `vehicules/`,
 * `parametrage/` et `recherche/`, aucune tâche n'a livré de couche HTTP pour ce module au
 * moment de L1-16 — signalé dans la réponse de tâche plutôt que comblé ici : écrire des
 * endpoints REST (routes, DTO de requête, codes de droit, exemples OpenAPI) sans le contrat
 * gelé (`contrats-api-etape-1.md`) reviendrait à inventer un contrat, hors périmètre de
 * l'assemblage.
 *
 * Les quatre services sont néanmoins déclarés ici et exportés : `JETON_COMPTEURS`
 * (`ServiceClient`) est fourni par `CompteursModule` (`@Global`, importé depuis
 * `ParametrageModule`), donc résolu sans import explicite. Exporter les services permet à un
 * futur `ClientsController` (ou à un autre module métier qui aurait un besoin de lecture
 * légitime) de les injecter sans dupliquer cette déclaration.
 */
@Module({
  providers: [ServiceClient, ServiceClientOrdresReparation, ServiceClientSousCollections, ServiceClientVehicules],
  exports: [ServiceClient, ServiceClientOrdresReparation, ServiceClientSousCollections, ServiceClientVehicules],
})
export class ClientsModule {}
