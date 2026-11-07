import { Injectable } from '@nestjs/common';
import type { AccountingExporter, CapacitesExport, CibleExport, EcritureExport } from '@dfa/shared';

import { serialiserEcrituresCsv, type LotCsv } from './csv-serialiseur';

/**
 * Adaptateur CSV générique — mêmes écritures que WinBIZ, autre sérialisation. Pur : aucun accès
 * base ni réseau. Pas de limite de taille de lot (aucun import tiers), donc un seul fichier.
 */
@Injectable()
export class CsvExporteurService implements AccountingExporter {
  readonly cible: CibleExport = 'csv';

  readonly capacites: CapacitesExport = {
    multiDevise: false,
    centresDeCharge: false,
    codesTva: true,
    granularite: ['detaille'],
  };

  genererLot(
    ecritures: readonly EcritureExport[],
    nomFichier: string,
    clientParReference: ReadonlyMap<string, string>,
  ): LotCsv {
    return serialiserEcrituresCsv(ecritures, clientParReference, nomFichier);
  }
}
