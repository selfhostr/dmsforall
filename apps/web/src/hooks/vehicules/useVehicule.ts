import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseVehicule } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { recupererVehicule } from './vehicules.api';

/** `GET /vehicules/{id}` — fiche complète (identité, données d'atelier, garanties). */
export function useVehicule(vehiculeId: string | undefined): UseQueryResult<ReponseVehicule> {
  return useQuery({
    queryKey: clesQuery.vehicules.detail(vehiculeId ?? ''),
    queryFn: () => recupererVehicule(vehiculeId as string),
    enabled: Boolean(vehiculeId),
  });
}
