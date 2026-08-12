import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseRendezVous } from '@dfa/shared';

import { listerRendezVousAVenirClient } from './rendez-vous-client.api';

/** Clé de cache locale — `clesQuery` (`api/cles.ts`) est hors périmètre d'écriture ici, même
 *  doctrine que `['vehicule-ordres-reparation', vehiculeId]` dans `EcranFicheVehicule.tsx`.
 *  Exportée pour que `SectionRendezVousClient` puisse invalider ce cache après création, sans
 *  dupliquer la clé. */
export function clesRendezVousAVenirClient(clientId: string): readonly unknown[] {
  return ['clients', clientId, 'rendez-vous-a-venir'];
}

/** Rendez-vous à venir d'un client — section « Prochains rendez-vous » de la fiche client, pour
 *  éviter un doublon au comptoir avant d'en proposer un second. */
export function useRendezVousAVenirClient(
  clientId: string | undefined,
): UseQueryResult<readonly ReponseRendezVous[]> {
  return useQuery({
    queryKey: clientId ? clesRendezVousAVenirClient(clientId) : clesRendezVousAVenirClient(''),
    queryFn: () => listerRendezVousAVenirClient(clientId as string),
    enabled: clientId !== undefined,
  });
}
