import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponsePrestation } from '@dfa/shared';

import { clesParametrage } from './cles';
import { listerPrestations } from './prestations.api';

/** `GET /referentiels/prestations` — pagination par curseur, même patron que
 *  `useListeTauxHoraires`. */
export function useListePrestations(): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponsePrestation>>, unknown> {
  return useInfiniteQuery({
    queryKey: clesParametrage.prestations.liste(),
    queryFn: ({ pageParam }) => listerPrestations(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
  });
}
