import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { FiltresFournisseurs, PageCurseur, ReponseFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { listerFournisseurs } from './fournisseurs.api';

const LIMITE_PAGE = 50;

export type ResultatListeFournisseurs = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseFournisseur>[] },
  unknown
> & {
  readonly fournisseurs: readonly ReponseFournisseur[];
};

/** `GET /fournisseurs` (RP-26), pagination par curseur — même architecture que `useListeArticles`. */
export function useListeFournisseurs(filtres: FiltresFournisseurs): ResultatListeFournisseurs {
  const resultat = useInfiniteQuery({
    queryKey: clesPieces.fournisseurs.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerFournisseurs(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    fournisseurs: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
