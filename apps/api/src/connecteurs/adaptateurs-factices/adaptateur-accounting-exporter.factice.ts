import { Injectable } from '@nestjs/common';
import type { NomInterfaceConnecteur } from '@dfa/shared';

import { AdaptateurConnecteurFactice } from './adaptateur-connecteur-factice.base';

/**
 * Adaptateur factice de l'interface `AccountingExporter` (§4, `fiduciaire`, `RC-50` → `RC-53`)
 * AU SENS DU REGISTRE GÉNÉRIQUE de ce socle — voir `adaptateur-connecteur-factice.base.ts` pour
 * ce que « factice » garantit ici.
 *
 * DISTINCTION IMPORTANTE, À NE PAS CONFONDRE : le contrat partagé `AccountingExporter`
 * (`packages/shared/src/contrats/facturation/export.ts`, `cible`/`capacites`) est un mécanisme
 * SÉPARÉ, DÉJÀ implémenté pour de vrai par `apps/api/src/facturation/export/winbiz/
 * winbiz-exporteur.service.ts` (hors du périmètre d'écriture de cette tâche —
 * `apps/api/src/facturation/**` appartient à un autre agent). Cette classe n'implémente PAS ce
 * contrat-là et ne s'y substitue pas : elle modélise seulement la présence — ou l'absence —
 * d'un connecteur `AccountingExporter` générique au niveau du REGISTRE (`RegistreConnecteursService`),
 * pour les futures cibles fiduciaires qui passeraient par ce socle générique plutôt que par le
 * mécanisme d'export fiduciaire déjà livré.
 */
@Injectable()
export class AdaptateurAccountingExporterFactice extends AdaptateurConnecteurFactice {
  readonly nomInterface: NomInterfaceConnecteur = 'AccountingExporter';
  readonly typeConnecteurCode = 'factice_accounting_exporter';
}
