import { Injectable } from '@nestjs/common';
import type { NomInterfaceConnecteur } from '@dfa/shared';

import { AdaptateurConnecteurFactice } from './adaptateur-connecteur-factice.base';

/** Adaptateur factice de l'interface `VehicleReferenceProvider` (§2, `oem`, `RC-20` → `RC-27`) —
 *  voir `adaptateur-connecteur-factice.base.ts` pour ce que « factice » garantit ici. */
@Injectable()
export class AdaptateurVehicleReferenceProviderFactice extends AdaptateurConnecteurFactice {
  readonly nomInterface: NomInterfaceConnecteur = 'VehicleReferenceProvider';
  readonly typeConnecteurCode = 'factice_vehicle_reference_provider';
}
