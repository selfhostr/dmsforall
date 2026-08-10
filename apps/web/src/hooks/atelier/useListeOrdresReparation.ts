import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { useListeCurseur } from '@/hooks/pagination-curseur';

import { listerOrdresReparation, type FiltresListeOrdresReparation } from './ordres-reparation.api';

const LIMITE_PAGE = 50;

export type ResultatListeOrdresReparation = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<OrdreReparationResume>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement
   *  (même contrat que `useListeVehicules`). */
  readonly ordres: readonly OrdreReparationResume[];
};

/** `GET /ordres-reparation`, pagination par curseur (`BoutonChargerPlus`, jamais de numéro de
 *  page — voir contrat `PageCurseur`). */
export function useListeOrdresReparation(
  filtres: FiltresListeOrdresReparation,
): ResultatListeOrdresReparation {
  const { resultat, elements } = useListeCurseur<OrdreReparationResume>({
    cle: clesQuery.or.liste(filtres),
    charger: (curseur) => listerOrdresReparation(filtres, { limite: LIMITE_PAGE, curseur }),
  });

  return { ...resultat, ordres: elements };
}
