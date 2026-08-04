import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { DocumentVenteResume, FiltresDocumentsVente, PageCurseur } from '@dfa/shared';

import { clesFacturation } from './cles';
import { listerDocumentsVente } from './documents-vente.api';

const LIMITE_PAGE = 50;

export type ResultatListeDocumentsVente = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<DocumentVenteResume>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement
   *  (même contrat que `useListeOrdresReparation`). */
  readonly documents: readonly DocumentVenteResume[];
};

/** `GET /documents-vente`, pagination par curseur — écran 5 (liste des factures). */
export function useListeDocumentsVente(
  filtres: FiltresDocumentsVente,
): ResultatListeDocumentsVente {
  const resultat = useInfiniteQuery({
    queryKey: clesFacturation.documents.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerDocumentsVente(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    documents: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
