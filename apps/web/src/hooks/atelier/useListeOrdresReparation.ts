import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

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
export function useListeOrdresReparation(filtres: FiltresListeOrdresReparation): ResultatListeOrdresReparation {
  const resultat = useInfiniteQuery({
    queryKey: clesQuery.or.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerOrdresReparation(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    ordres: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
