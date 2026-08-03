import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import type { PageCurseur, ReponseTauxHoraire } from '@dfa/shared';

import { clesParametrage } from './cles';
import { listerTauxHoraires } from './taux-horaires.api';

/** `GET /referentiels/taux-horaires` — pagination par curseur (`BoutonChargerPlus`), même patron
 *  que `useListeClients`. Ouvert à tout rôle authentifié (`parametrage.referentiel.lire`). */
export function useListeTauxHoraires(): UseInfiniteQueryResult<
  InfiniteData<PageCurseur<ReponseTauxHoraire>>,
  unknown
> {
  return useInfiniteQuery({
    queryKey: clesParametrage.tauxHoraires.liste(),
    queryFn: ({ pageParam }) => listerTauxHoraires(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
  });
}
