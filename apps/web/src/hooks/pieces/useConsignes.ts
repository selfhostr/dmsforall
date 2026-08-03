import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { FiltresConsignes, PageCurseur, ReponseConsigneEchangeStandard } from '@dfa/shared';

import { clesPieces } from './cles';
import { listerConsignes } from './consignes.api';

const LIMITE_PAGE = 50;

export type ResultatConsignes = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseConsigneEchangeStandard>[] },
  unknown
> & {
  readonly consignes: readonly ReponseConsigneEchangeStandard[];
};

/** `GET /consignes` — vue transverse (§7.7), pagination par curseur. */
export function useConsignes(filtres: FiltresConsignes): ResultatConsignes {
  const resultat = useInfiniteQuery({
    queryKey: clesPieces.consignes.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerConsignes(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    consignes: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
