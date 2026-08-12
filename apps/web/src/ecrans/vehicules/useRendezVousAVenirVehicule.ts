import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseRendezVous } from '@dfa/shared';

import { listerRendezVousAVenirVehicule } from './rendez-vous-vehicule.api';

/** Clé de cache locale — `clesQuery` (`api/cles.ts`) est hors périmètre d'écriture ici, même
 *  doctrine que `['vehicule-ordres-reparation', vehiculeId]` déjà présent dans
 *  `EcranFicheVehicule.tsx`. Exportée pour invalider ce cache après création. */
export function clesRendezVousAVenirVehicule(vehiculeId: string): readonly unknown[] {
  return ['vehicules', vehiculeId, 'rendez-vous-a-venir'];
}

/** `enabled` seulement si un détenteur courant est connu (`clientDetenteurId`) — voir
 *  `rendez-vous-vehicule.api.ts` : aucun filtre serveur `vehiculeId` n'existe pour s'en passer.
 *  Distinct d'une liste VIDE (« aucun rendez-vous ») : ici, on ne SAIT PAS — l'appelant doit rendre
 *  ce cas différemment (§ règle « absence de donnée ≠ valeur »). */
export function useRendezVousAVenirVehicule(
  vehiculeId: string | undefined,
  clientDetenteurId: string | undefined,
): UseQueryResult<readonly ReponseRendezVous[]> {
  return useQuery({
    queryKey: clesRendezVousAVenirVehicule(vehiculeId ?? ''),
    queryFn: () =>
      listerRendezVousAVenirVehicule(clientDetenteurId as string, vehiculeId as string),
    enabled: vehiculeId !== undefined && clientDetenteurId !== undefined,
  });
}
