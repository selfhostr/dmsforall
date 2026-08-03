import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { FiltresReservations, PageCurseur, ReponseReservationPiece } from '@dfa/shared';

import { clesPieces } from './cles';
import { listerReservations } from './reservations.api';

const LIMITE_PAGE = 50;

export type ResultatReservations = UseInfiniteQueryResult<{ readonly pages: readonly PageCurseur<ReponseReservationPiece>[] }, unknown> & {
  readonly reservations: readonly ReponseReservationPiece[];
};

/** `GET /reservations` — vue transverse (magasinier, chef d'atelier) : qu'est-ce qui est
 *  réservé, pour qui, depuis quand. Pagination par curseur. */
export function useReservations(filtres: FiltresReservations): ResultatReservations {
  const resultat = useInfiniteQuery({
    queryKey: clesPieces.reservations.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerReservations(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    reservations: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
