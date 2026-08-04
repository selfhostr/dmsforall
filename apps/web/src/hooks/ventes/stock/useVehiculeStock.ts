import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseVehiculeStock } from '@dfa/shared';

import { clesVentesStock } from './cles';
import { recupererVehiculeStock } from './vehicule-stock.api';

/** `GET /vehicules/{vehiculeId}/stock` — même convention que `useArticle`/`useVehicule` :
 *  `enabled: false` tant que l'identifiant de route n'est pas résolu (jamais d'appel avec un id
 *  `undefined`). 404 (jamais mis en stock) remonte comme `isError`, propagé tel quel. */
export function useVehiculeStock(
  vehiculeId: string | undefined,
): UseQueryResult<ReponseVehiculeStock> {
  return useQuery({
    queryKey: clesVentesStock.detail(vehiculeId ?? ''),
    queryFn: () => recupererVehiculeStock(vehiculeId as string),
    enabled: vehiculeId !== undefined,
  });
}
