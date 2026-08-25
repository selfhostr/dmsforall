/**
 * Accumulation de la réconciliation PAR ANNÉE — pur, arithmétique ENTIÈRE (centimes), jamais un
 * flottant. Extrait de `service-import-reprise.ts` pour rester testable sans base ni port de
 * lecture : c'est la seule preuve chiffrée que le rapport ne perd rien (brief).
 */

export interface AccumulateurAnneeReprise {
  readonly documents: number;
  readonly totalCentimes: number;
}

export type MapReconciliationAnnee = ReadonlyMap<number, AccumulateurAnneeReprise>;

export function accumulerDocumentReconciliation(
  courant: MapReconciliationAnnee,
  annee: number,
  montantCentimes: number,
): MapReconciliationAnnee {
  const existant = courant.get(annee) ?? { documents: 0, totalCentimes: 0 };
  const suivant = new Map(courant);
  suivant.set(annee, {
    documents: existant.documents + 1,
    totalCentimes: existant.totalCentimes + montantCentimes,
  });
  return suivant;
}
