import { Injectable } from '@nestjs/common';
import type { NomInterfaceConnecteur } from '@dfa/shared';

import { AdaptateurConnecteurFactice } from './adaptateur-connecteur-factice.base';

/** Adaptateur factice de l'interface `PartsCatalogProvider` (§6, `fournisseur_pieces`,
 *  `RC-70` → `RC-74`) — voir `adaptateur-connecteur-factice.base.ts` pour ce que « factice »
 *  garantit ici. */
@Injectable()
export class AdaptateurPartsCatalogProviderFactice extends AdaptateurConnecteurFactice {
  readonly nomInterface: NomInterfaceConnecteur = 'PartsCatalogProvider';
  readonly typeConnecteurCode = 'factice_parts_catalog_provider';
}
