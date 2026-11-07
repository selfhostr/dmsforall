import type { MoyenPaiement } from '@dfa/shared';

/** Arrondi commercial au 5 centimes (RF-49). `Math.round` centré : 2 et 3 centimes d'écart se
 *  répartissent symétriquement. */
export function arrondirA5Centimes(centimes: number): number {
  return Math.round(centimes / 5) * 5;
}

export interface MontantPourMoyen {
  /** Montant à remettre au comptoir (ou à débiter) pour ce moyen. */
  readonly montantCentimes: number;
  /** `montantCentimes - exactCentimes` : non nul uniquement pour des espèces arrondies. */
  readonly ecartArrondiCentimes: number;
}

/**
 * Montant à encaisser pour solder `exactCentimes` avec un moyen donné : seules les espèces sont
 * arrondies au 5 centimes (pas de pièce de 1 ou 2 ct) ; carte, TWINT, virement… paient au centime
 * près. Recalculé à CHAQUE changement de moyen à partir du montant exact — jamais depuis le montant
 * déjà arrondi, sinon 109.44 deviendrait 109.45 pour de bon.
 */
export function montantPourMoyen(exactCentimes: number, moyen: MoyenPaiement): MontantPourMoyen {
  if (moyen !== 'especes') return { montantCentimes: exactCentimes, ecartArrondiCentimes: 0 };
  const montantCentimes = arrondirA5Centimes(exactCentimes);
  return { montantCentimes, ecartArrondiCentimes: montantCentimes - exactCentimes };
}
