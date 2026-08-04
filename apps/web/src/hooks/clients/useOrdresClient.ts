import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import type { OrdreReparationResume, PageCurseur, StatutOrdreReparation } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

import { construireRequete, exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

export interface FiltresOrClient {
  readonly statut?: readonly StatutOrdreReparation[];
  readonly tri?: 'ouvertLe:desc' | 'ouvertLe:asc';
}

/** `GET /clients/{id}/ordres-reparation` — onglet « Derniers passages à l'atelier » (RM-21 : les
 *  OR restent attachés au client de l'époque, même après une fusion). */
export function useOrdresClient(
  clientId: string | undefined,
  filtres: FiltresOrClient = {},
): UseInfiniteQueryResult<InfiniteData<PageCurseur<OrdreReparationResume>>, unknown> {
  return useInfiniteQuery({
    queryKey: clesQuery.clients.ordres(clientId ?? ''),
    queryFn: async ({ pageParam }) => {
      const params = construireRequete(
        {
          tri: filtres.tri ?? 'ouvertLe:desc',
          limite: LIMITE_PAR_PAGE,
          curseur: pageParam ?? undefined,
        },
        { statut: filtres.statut },
      );
      const page = await requeteApi<PageCurseur<OrdreReparationResume>>(
        `/clients/${clientId}/ordres-reparation?${params.toString()}`,
        { method: 'GET' },
      );
      return exigerCorps(page, `GET /clients/${clientId ?? ''}/ordres-reparation`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
    enabled: Boolean(clientId),
  });
}
