import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseArticle } from '@dfa/shared';

import { clesPieces } from './cles';
import { listerArticles, type FiltresListeArticles } from './articles.api';

const LIMITE_PAGE = 50;

export type ResultatListeArticles = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseArticle>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement,
   *  même convention que `useListeVehicules`. */
  readonly articles: readonly ReponseArticle[];
};

/** Liste des articles du tenant (RP-03), pagination par curseur (`BoutonChargerPlus`). */
export function useListeArticles(filtres: FiltresListeArticles): ResultatListeArticles {
  const resultat = useInfiniteQuery({
    queryKey: clesPieces.articles.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerArticles(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    articles: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
