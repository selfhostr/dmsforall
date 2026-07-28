import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import type {
  EntreeConsentementClient,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseClientConsentement,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { donneesEcriture } from '@/api/enveloppe';

import { construireRequete, exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

/** `GET /clients/{id}/consentements` (RM-09, nLPD, APPEND-ONLY) — onglet « Consentements » de la
 *  fiche. Aucun `PATCH`/`DELETE` : une révocation est une nouvelle ligne `accorde: false`. */
export function useConsentementsClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientConsentement>>, unknown> {
  return useInfiniteQuery({
    queryKey: clesQuery.clients.consentements(clientId ?? ''),
    queryFn: async ({ pageParam }) => {
      const params = construireRequete({ limite: LIMITE_PAR_PAGE, curseur: pageParam ?? undefined });
      const page = await requeteApi<PageCurseur<ReponseClientConsentement>>(
        `/clients/${clientId}/consentements?${params.toString()}`,
        { method: 'GET' },
      );
      return exigerCorps(page, `GET /clients/${clientId ?? ''}/consentements`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
    enabled: Boolean(clientId),
  });
}

/** `POST /clients/{id}/consentements`. */
export function useCreerConsentementClient(
  clientId: string,
): UseMutationResult<ReponseClientConsentement, unknown, EntreeConsentementClient> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entree: EntreeConsentementClient) => {
      const reponse = await requeteApi<ReponseAvecAvertissements<ReponseClientConsentement>>(
        `/clients/${clientId}/consentements`,
        { method: 'POST', body: JSON.stringify(entree) },
      );
      return donneesEcriture(exigerCorps(reponse, `POST /clients/${clientId}/consentements`));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.clients.consentements(clientId) });
    },
  });
}
