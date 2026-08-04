import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import {
  TRI_DEFAUT_REAPPROVISIONNEMENT,
  type FiltresReapprovisionnement,
  type LigneReapprovisionnement,
  type PageCurseur,
} from '@dfa/shared';

import { clesPieces } from './cles';
import { listerReapprovisionnement } from './stock.api';

const LIMITE_PAGE = 50;

export type ResultatReapprovisionnement = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<LigneReapprovisionnement>[] },
  unknown
> & {
  readonly lignes: readonly LigneReapprovisionnement[];
};

/** `GET /stock/reapprovisionnement?siteId=` (RP-12) — propose, ne commande jamais
 *  automatiquement. `enabled: false` tant qu'aucun site n'est sélectionné. */
export function useReapprovisionnement(siteId: string | undefined): ResultatReapprovisionnement {
  const filtres: FiltresReapprovisionnement = {
    siteId: siteId ?? '',
    tri: TRI_DEFAUT_REAPPROVISIONNEMENT,
    limite: LIMITE_PAGE,
  };

  const resultat = useInfiniteQuery({
    queryKey: clesPieces.stock.reapprovisionnement(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerReapprovisionnement(
        { siteId: siteId as string, tri: filtres.tri },
        { limite: LIMITE_PAGE, curseur: pageParam },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
    enabled: siteId !== undefined,
  });

  return {
    ...resultat,
    lignes: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
