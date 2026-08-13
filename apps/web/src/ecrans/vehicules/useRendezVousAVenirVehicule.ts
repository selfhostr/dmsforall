import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseRendezVous } from '@dfa/shared';

import { listerRendezVousAVenirVehicule } from './rendez-vous-vehicule.api';

/** Clé de cache locale — `clesQuery` (`api/cles.ts`) est hors périmètre d'écriture ici, même
 *  doctrine que `['vehicule-ordres-reparation', vehiculeId]` déjà présent dans
 *  `EcranFicheVehicule.tsx`. Exportée pour invalider ce cache après création. */
export function clesRendezVousAVenirVehicule(vehiculeId: string): readonly unknown[] {
  return ['vehicules', vehiculeId, 'rendez-vous-a-venir'];
}

/**
 * Rendez-vous à venir de CE véhicule, filtre `vehiculeId` appliqué côté serveur (voir
 * `rendez-vous-vehicule.api.ts`) — n'a plus besoin du détenteur courant (issue #97) : un véhicule
 * sans détenteur affiche désormais ses rendez-vous comme n'importe quel autre.
 */
export function useRendezVousAVenirVehicule(
  vehiculeId: string | undefined,
): UseQueryResult<readonly ReponseRendezVous[]> {
  return useQuery({
    queryKey: clesRendezVousAVenirVehicule(vehiculeId ?? ''),
    queryFn: () => listerRendezVousAVenirVehicule(vehiculeId as string),
    enabled: vehiculeId !== undefined,
  });
}
