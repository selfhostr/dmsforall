import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseMotifRendezVous } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { listerMotifsRendezVous } from './rendez-vous.api';

/** `GET /motifs-rendez-vous` — référentiel garage, quasi statique (`staleTime` long, comme
 *  `clesQuery.referentiels.*` ailleurs) : pas de raison de le relire à chaque ouverture du
 *  dialogue de prise de rendez-vous.
 *
 *  `{ actifs: true }` (prise de rendez-vous) : le serveur ne rend que les motifs proposables.
 *  Sans option (paramétrage) : tous les motifs, y compris inactifs, pour pouvoir les réactiver. */
export function useMotifsRendezVous(
  options: { readonly actifs?: boolean } = {},
): UseQueryResult<readonly ReponseMotifRendezVous[]> {
  return useQuery({
    queryKey:
      options.actifs === true
        ? clesQuery.referentiels.motifsRdvActifs()
        : clesQuery.referentiels.motifsRdv(),
    queryFn: () => listerMotifsRendezVous(options.actifs === true ? { actifs: true } : {}),
    staleTime: 5 * 60 * 1000,
  });
}
