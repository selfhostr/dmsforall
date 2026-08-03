import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import type { PageCurseur, ReponseClientCondition } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

import { construireRequete, exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

/** `GET /clients/{id}/conditions` (RM-07, conditions DATÉES) — onglet « Conditions
 *  commerciales » de la fiche. Lecture seule au lot 1 : aucune action « ajouter » au contrat
 *  (voir `clients:conditions`, i18n, qui ne porte pas de clé `ajouter`, contrairement aux autres
 *  sous-collections). */
export function useConditionsClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientCondition>>, unknown> {
  return useInfiniteQuery({
    queryKey: clesQuery.clients.conditions(clientId ?? ''),
    queryFn: async ({ pageParam }) => {
      const params = construireRequete({
        limite: LIMITE_PAR_PAGE,
        curseur: pageParam ?? undefined,
      });
      const page = await requeteApi<PageCurseur<ReponseClientCondition>>(
        `/clients/${clientId}/conditions?${params.toString()}`,
        { method: 'GET' },
      );
      return exigerCorps(page, `GET /clients/${clientId ?? ''}/conditions`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
    enabled: Boolean(clientId),
  });
}
