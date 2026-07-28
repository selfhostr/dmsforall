import { useInfiniteQuery, type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, VehiculeResume } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

import { construireRequete, exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

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
  return useInfiniteQuery({
    queryKey: clesQuery.clients.vehicules(clientId ?? ''),
    queryFn: async ({ pageParam }) => {
      const params = construireRequete({
        inclureAnciennesDetentions: filtres.inclureAnciennesDetentions,
        tri: filtres.tri,
        limite: LIMITE_PAR_PAGE,
        curseur: pageParam ?? undefined,
      });
      const page = await requeteApi<PageCurseur<VehiculeResume>>(`/clients/${clientId}/vehicules?${params.toString()}`, {
        method: 'GET',
      });
      return exigerCorps(page, `GET /clients/${clientId ?? ''}/vehicules`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
    enabled: Boolean(clientId),
  });
}
