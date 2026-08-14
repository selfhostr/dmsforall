import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseMotifRendezVous } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { listerMotifsRendezVous } from './rendez-vous.api';

/** `GET /motifs-rendez-vous` — référentiel garage, quasi statique (`staleTime` long, comme
 *  `clesQuery.referentiels.*` ailleurs) : pas de raison de le relire à chaque ouverture du
 *  dialogue de prise de rendez-vous. */
export function useMotifsRendezVous(): UseQueryResult<readonly ReponseMotifRendezVous[]> {
  return useQuery({
    queryKey: clesQuery.referentiels.motifsRdv(),
    queryFn: listerMotifsRendezVous,
    staleTime: 5 * 60 * 1000,
  });
}
