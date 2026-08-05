import { Module } from '@nestjs/common';

import type { AdaptateurConnecteur } from './adaptateur-connecteur';
import {
  AdaptateurAccountingExporterFactice,
  AdaptateurListingPublisherFactice,
  AdaptateurOrderProviderFactice,
  AdaptateurPartsCatalogProviderFactice,
  AdaptateurVehicleReferenceProviderFactice,
} from './adaptateurs-factices';
import {
  JETON_ADAPTATEURS_CONNECTEUR,
  JETON_SOURCE_ACTIVATIONS_CONNECTEUR,
} from './connecteurs.jetons';
import { ServiceAttente } from './resilience/service-attente';
import { ServiceExecuteurConnecteurResilient } from './resilience/service-executeur-connecteur-resilient';
import { RegistreConnecteursService } from './service-registre-connecteurs';
import { SourceActivationsConnecteurAucune } from './source-activations-connecteur';

const ADAPTATEURS_FACTICES = [
  AdaptateurPartsCatalogProviderFactice,
  AdaptateurVehicleReferenceProviderFactice,
  AdaptateurOrderProviderFactice,
  AdaptateurListingPublisherFactice,
  AdaptateurAccountingExporterFactice,
] as const;

/**
 * Socle d'exécution de l'étape 5 (Connecteurs) : registre (résolution par tenant), exécuteur
 * résilient (délai/réessais/disjoncteur) et un adaptateur factice par interface stable.
 *
 * `JETON_SOURCE_ACTIVATIONS_CONNECTEUR` est câblé sur `SourceActivationsConnecteurAucune` — AUCUNE
 * table `connecteur_activation` n'existe dans ce dépôt à ce jour (voir l'en-tête de
 * `source-activations-connecteur.ts` pour l'état réel et ce qu'une future implémentation
 * persistée devrait porter). Résultat : `RegistreConnecteursService.resoudre(...)` rend TOUJOURS
 * `null` aujourd'hui, pour tout tenant — le comportement correct tant que rien n'est configurable,
 * pas un défaut de ce module.
 *
 * `JETON_ADAPTATEURS_CONNECTEUR` agrège les adaptateurs déployés dans CE processus. Extension
 * point pour un futur adaptateur réel : l'ajouter à `ADAPTATEURS_FACTICES` (renommé) ou à une
 * liste voisine, et à `inject` de la fabrique ci-dessous — le registre n'a besoin de rien de plus
 * pour le voir apparaître, `typeConnecteurCode` faisant déjà l'aiguillage.
 *
 * Non enregistré dans `AppModule` par ce module lui-même — importé par l'orchestrateur (voir
 * `apps/api/src/app.module.ts`), même patron que `PointageModule`/`PneusModule`. Aucun contrôleur
 * HTTP : ce socle n'expose aucune route, il fournit des services que d'autres modules pourront
 * injecter (`RegistreConnecteursService`, `ServiceExecuteurConnecteurResilient`) une fois leurs
 * propres besoins de connecteur définis — hors du périmètre de cette tâche (« expose le socle,
 * les branchements viendront après »).
 */
@Module({
  providers: [
    ServiceAttente,
    ServiceExecuteurConnecteurResilient,
    RegistreConnecteursService,
    { provide: JETON_SOURCE_ACTIVATIONS_CONNECTEUR, useClass: SourceActivationsConnecteurAucune },
    ...ADAPTATEURS_FACTICES,
    {
      provide: JETON_ADAPTATEURS_CONNECTEUR,
      useFactory: (...adaptateurs: AdaptateurConnecteur[]): readonly AdaptateurConnecteur[] =>
        adaptateurs,
      inject: [...ADAPTATEURS_FACTICES],
    },
  ],
  exports: [RegistreConnecteursService, ServiceExecuteurConnecteurResilient],
})
export class ConnecteursModule {}
