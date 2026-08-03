import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseContexteAtelier } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { recupererContexteAtelier } from './vehicules.api';

/** `GET /vehicules/{id}/contexte-atelier` — ce qu'un garagiste doit voir SANS CLIQUER quand une
 *  voiture se présente (expertise échue, campagnes, travaux reportés, alertes client). */
export function useContexteAtelier(
  vehiculeId: string | undefined,
): UseQueryResult<ReponseContexteAtelier> {
  return useQuery({
    queryKey: clesQuery.vehicules.contexteAtelier(vehiculeId ?? ''),
    queryFn: () => recupererContexteAtelier(vehiculeId as string),
    enabled: Boolean(vehiculeId),
  });
}
