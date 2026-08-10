import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { FiltresReservations, PageCurseur, ReponseReservationPiece } from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import { listerReservations } from './reservations.api';

const LIMITE_PAGE = 50;

export type ResultatReservations = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseReservationPiece>[] },
  unknown
> & {
  readonly reservations: readonly ReponseReservationPiece[];
};

/** `GET /reservations` — vue transverse (magasinier, chef d'atelier) : qu'est-ce qui est
 *  réservé, pour qui, depuis quand. Pagination par curseur. `reessayer` : RF-115, `admin` porte
 *  `[]` sur tout le domaine Pièces (`matrice-droits.ts`), même raison que `useListeArticles`. */
export function useReservations(filtres: FiltresReservations): ResultatReservations {
  const reessayer = useDoitReessayer();
  const { resultat, elements } = useListeCurseur<ReponseReservationPiece>({
    cle: clesPieces.reservations.liste(filtres),
    charger: (curseur) => listerReservations(filtres, { limite: LIMITE_PAGE, curseur }),
    reessayer,
  });

  return { ...resultat, reservations: elements };
}
