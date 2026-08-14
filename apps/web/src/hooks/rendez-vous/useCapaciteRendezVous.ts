import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseCapaciteRendezVous } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { capaciteRendezVous, type FiltresPeriodeRendezVous } from './rendez-vous.api';

/** `GET /rendez-vous/capacite` sur une période — clé `clesQuery.rdv.charge` (fabrique gelée). Même
 *  garde `enabled` que `useAgendaRendezVous` : pas de requête tant que le site n'est pas connu. */
export function useCapaciteRendezVous(
  filtres: FiltresPeriodeRendezVous | undefined,
): UseQueryResult<ReponseCapaciteRendezVous> {
  return useQuery({
    queryKey: filtres
      ? clesQuery.rdv.charge(filtres.siteId, filtres.du, filtres.au)
      : clesQuery.rdv.charge('', '', ''),
    queryFn: () => capaciteRendezVous(filtres as FiltresPeriodeRendezVous),
    enabled: filtres !== undefined,
  });
}
