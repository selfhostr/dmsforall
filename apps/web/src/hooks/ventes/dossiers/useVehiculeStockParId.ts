import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseVehiculeStock } from '@dfa/shared';

import { recupererVehiculeStock } from './vehicules-stock-selection.api';

/** `GET /vehicules/{vehiculeId}/stock` — UNIQUEMENT pour afficher l'identité d'un véhicule
 *  pré-rempli via `?vehiculeId=` sur l'écran de création (design §5.4). `data === null` : jamais
 *  mis en stock ou identifiant absent — l'écran retombe alors sur `SelecteurVehiculeStockDossier`. */
export function useVehiculeStockParId(
  vehiculeId: string | undefined,
): UseQueryResult<ReponseVehiculeStock | null> {
  return useQuery({
    queryKey: ['ventes', 'dossiers', 'vehiculeStockParId', vehiculeId ?? ''],
    queryFn: () => recupererVehiculeStock(vehiculeId as string),
    enabled: vehiculeId !== undefined,
  });
}
