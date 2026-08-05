import { Injectable } from '@nestjs/common';
import type { NomInterfaceConnecteur } from '@dfa/shared';

import { AdaptateurConnecteurFactice } from './adaptateur-connecteur-factice.base';

/** Adaptateur factice de l'interface `OrderProvider` (transmission de commande, §6,
 *  `fournisseur_pieces`, `RC-73`) — voir `adaptateur-connecteur-factice.base.ts` pour ce que
 *  « factice » garantit ici. */
@Injectable()
export class AdaptateurOrderProviderFactice extends AdaptateurConnecteurFactice {
  readonly nomInterface: NomInterfaceConnecteur = 'OrderProvider';
  readonly typeConnecteurCode = 'factice_order_provider';
}
