import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseDepotPneus } from '@dfa/shared';

import { clesPneus } from './cles';
import { recupererHangarPneus, type FiltresHangar } from './depot-pneus.api';

const LIMITE_PAGE = 50;

export type ResultatHangarPneus = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseDepotPneus>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement,
   *  même convention que `useListeArticles`/`useListeVehicules`. */
  readonly depots: readonly ReponseDepotPneus[];
};

/** `GET /sites/{siteId}/hangar-pneus` — vue hangar du site (spec §5, §6), pagination par
 *  curseur (`BoutonChargerPlus`). */
export function useHangarPneus(
  siteId: string | undefined,
  filtres: FiltresHangar,
): ResultatHangarPneus {
  const resultat = useInfiniteQuery({
    queryKey: clesPneus.hangar.liste(siteId ?? '', filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      recupererHangarPneus(siteId as string, filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
    enabled: siteId !== undefined,
  });

  return {
    ...resultat,
    depots: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
