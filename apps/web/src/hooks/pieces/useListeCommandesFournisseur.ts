import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { FiltresCommandesFournisseur, PageCurseur, ReponseCommandeFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { listerCommandesFournisseur } from './commandes-fournisseur.api';

const LIMITE_PAGE = 50;

export type ResultatListeCommandesFournisseur = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseCommandeFournisseur>[] },
  unknown
> & {
  readonly commandes: readonly ReponseCommandeFournisseur[];
};

/** `GET /commandes-fournisseur` (RP-26 → RP-31), pagination par curseur — même architecture que
 *  `useListeArticles`. */
export function useListeCommandesFournisseur(filtres: FiltresCommandesFournisseur): ResultatListeCommandesFournisseur {
  const resultat = useInfiniteQuery({
    queryKey: clesPieces.commandesFournisseur.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerCommandesFournisseur(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    commandes: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
