import { Injectable } from '@nestjs/common';
import type { NomInterfaceConnecteur } from '@dfa/shared';

import { AdaptateurConnecteurFactice } from './adaptateur-connecteur-factice.base';

/** Adaptateur factice de l'interface `ListingPublisher` (§3, `plateforme_annonces`, `RC-40` →
 *  `RC-46`) — voir `adaptateur-connecteur-factice.base.ts` pour ce que « factice » garantit ici. */
@Injectable()
export class AdaptateurListingPublisherFactice extends AdaptateurConnecteurFactice {
  readonly nomInterface: NomInterfaceConnecteur = 'ListingPublisher';
  readonly typeConnecteurCode = 'factice_listing_publisher';
}
