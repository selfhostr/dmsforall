import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, VehiculeStockResume } from '@dfa/shared';

import { clesVentesStock } from './cles';
import { listerVehiculesStock, type FiltresListeVehiculesStock } from './vehicule-stock.api';

const LIMITE_PAGE = 50;

export type ResultatListeVehiculesStock = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<VehiculeStockResume>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement,
   *  même convention que `useListeArticles`/`useListeVehicules`. */
  readonly vehiculesStock: readonly VehiculeStockResume[];
};

/** `GET /vehicules-stock` (RV-01→RV-14, priorité 4 du module) — pagination par curseur
 *  (`BoutonChargerPlus`). */
export function useListeVehiculesStock(
  filtres: FiltresListeVehiculesStock,
): ResultatListeVehiculesStock {
  const resultat = useInfiniteQuery({
    queryKey: clesVentesStock.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerVehiculesStock(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    vehiculesStock: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
