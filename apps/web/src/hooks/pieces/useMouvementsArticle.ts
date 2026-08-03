import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import {
  TRI_DEFAUT_MOUVEMENTS_STOCK,
  type FiltresMouvementsStock,
  type PageCurseur,
  type ReponseMouvementStock,
  type TypeMouvementStock,
} from '@dfa/shared';

import { clesPieces } from './cles';
import { listerMouvementsArticle } from './mouvements.api';

const LIMITE_PAGE = 30;

export type ResultatMouvementsArticle = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseMouvementStock>[] },
  unknown
> & {
  readonly mouvements: readonly ReponseMouvementStock[];
};

/** Filtres réellement exposés par l'écran — forme réduite plutôt que `FiltresMouvementsStock`
 *  directement : ce dernier (`z.infer` d'un schéma dont `limite`/`tri` portent `.default()`) a
 *  `limite`/`tri` non optionnels EN SORTIE malgré `.default()` — les recomposer ici évite un
 *  faux-optionnel qui échoue `tsc` à l'appel. */
interface FiltresMouvementsArticleEcran {
  // Non-`readonly` : doit rester structurellement assignable à `FiltresMouvementsStock.type`
  // (`z.infer` d'un `z.array(...)`, toujours un tableau MUTABLE côté type, jamais `readonly`).
  readonly type?: TypeMouvementStock[];
  readonly siteId?: string;
  readonly dateDe?: string;
  readonly dateA?: string;
}

/** `GET /articles/{id}/mouvements` — historique complet, pagination par curseur. `enabled: false`
 *  tant que l'article n'est pas résolu (fiche article encore en chargement). */
export function useMouvementsArticle(
  articleId: string | undefined,
  filtres: FiltresMouvementsArticleEcran = {},
): ResultatMouvementsArticle {
  const filtresComplets: FiltresMouvementsStock = {
    ...filtres,
    tri: TRI_DEFAUT_MOUVEMENTS_STOCK,
    limite: LIMITE_PAGE,
  };

  const resultat = useInfiniteQuery({
    queryKey: clesPieces.articles.mouvements(articleId ?? '', filtresComplets),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerMouvementsArticle(articleId as string, filtresComplets, {
        limite: LIMITE_PAGE,
        curseur: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
    enabled: articleId !== undefined,
  });

  return {
    ...resultat,
    mouvements: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
