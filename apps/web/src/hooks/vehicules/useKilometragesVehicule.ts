import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseVehiculeKilometrage } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { listerKilometragesVehicule } from './vehicules.api';

/** `GET /vehicules/{id}/kilometrages` — historique APPEND-ONLY (RM-23/24/25), déjà trié par le
 *  serveur (`TRI_DEFAUT_KILOMETRAGES` = `releveLe:desc`) : `FriseKilometrage` ne retrie jamais. */
export function useKilometragesVehicule(vehiculeId: string | undefined): UseQueryResult<readonly ReponseVehiculeKilometrage[]> {
  return useQuery({
    queryKey: clesQuery.vehicules.kilometrages(vehiculeId ?? ''),
    queryFn: () => listerKilometragesVehicule(vehiculeId as string),
    enabled: Boolean(vehiculeId),
  });
}
