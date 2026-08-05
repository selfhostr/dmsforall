import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseDepotPneus } from '@dfa/shared';

import { clesPneus } from './cles';
import { listerDepotsPneusARelancer, type FiltresARelancer } from './depot-pneus.api';

const LIMITE_PAGE = 50;

export type ResultatJeuxARelancer = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseDepotPneus>[] },
  unknown
> & {
  readonly depots: readonly ReponseDepotPneus[];
};

/** `GET /depots-pneus/a-relancer` (RPP-04) — jeux oubliés depuis plus de deux ans (délai serveur,
 *  §3 de la spec), site ou tenant entier selon `filtres.siteId`. */
export function useJeuxARelancer(filtres: FiltresARelancer): ResultatJeuxARelancer {
  const resultat = useInfiniteQuery({
    queryKey: clesPneus.aRelancer.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerDepotsPneusARelancer(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    depots: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
