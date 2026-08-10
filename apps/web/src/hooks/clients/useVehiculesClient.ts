import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, VehiculeResume } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { chargeurSousCollectionClient } from './support';

export interface FiltresVehiculesClient {
  /** RM-20 : les détentions closes ne sont visibles que sur demande explicite. */
  readonly inclureAnciennesDetentions?: boolean;
  readonly tri?: 'plaque:asc' | 'plaque:desc';
}

/** `GET /clients/{id}/vehicules` — onglet « Véhicules du client » de la fiche. */
export function useVehiculesClient(
  clientId: string | undefined,
  filtres: FiltresVehiculesClient = {},
): UseInfiniteQueryResult<InfiniteData<PageCurseur<VehiculeResume>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<VehiculeResume>({
    cle: clesQuery.clients.vehicules(clientId ?? ''),
    charger: clientId
      ? chargeurSousCollectionClient(clientId, 'vehicules', {
          inclureAnciennesDetentions: filtres.inclureAnciennesDetentions,
          tri: filtres.tri,
        })
      : undefined,
    reessayer,
  });
  return resultat;
}
