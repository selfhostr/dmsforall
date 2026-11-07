/**
 * `EXPORT_ECRITURES_DESEQUILIBREES` (MD-85) : une écriture construite ne respecte pas
 * Σ débits = Σ crédits. Typée (et non une `Error` brute, qui sortait en `500`) pour que le service
 * la collecte, que l'aperçu la liste, et que le `409` la nomme dans `blocages[].donnees`.
 */

import { ErreurMetier } from '../../../common/erreurs';

export class ErreurEcritureDesequilibree extends ErreurMetier {
  readonly reference: string;
  /** Présent pour une écriture de document ; `null` pour une écriture de paiement. */
  readonly documentId: string | null;
  readonly totalDebitCentimes: bigint;
  readonly totalCreditCentimes: bigint;

  constructor(
    message: string,
    donnees: {
      readonly reference: string;
      readonly documentId: string | null;
      readonly totalDebitCentimes: bigint;
      readonly totalCreditCentimes: bigint;
    },
  ) {
    super('EXPORT_ECRITURES_DESEQUILIBREES', message, { detail: message });
    this.name = 'ErreurEcritureDesequilibree';
    this.reference = donnees.reference;
    this.documentId = donnees.documentId;
    this.totalDebitCentimes = donnees.totalDebitCentimes;
    this.totalCreditCentimes = donnees.totalCreditCentimes;
  }
}
