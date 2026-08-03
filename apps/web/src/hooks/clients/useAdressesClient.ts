import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import type {
  EntreeAdresseClient,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseClientAdresse,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { donneesEcriture } from '@/api/enveloppe';

import { construireRequete, exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

/** `GET /clients/{id}/adresses` (RM-03, une seule `principale` active à la fois) — onglet
 *  « Adresses » de la fiche. */
export function useAdressesClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientAdresse>>, unknown> {
  return useInfiniteQuery({
    queryKey: clesQuery.clients.adresses(clientId ?? ''),
    queryFn: async ({ pageParam }) => {
      const params = construireRequete({
        limite: LIMITE_PAR_PAGE,
        curseur: pageParam ?? undefined,
      });
      const page = await requeteApi<PageCurseur<ReponseClientAdresse>>(
        `/clients/${clientId}/adresses?${params.toString()}`,
        { method: 'GET' },
      );
      return exigerCorps(page, `GET /clients/${clientId ?? ''}/adresses`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
    enabled: Boolean(clientId),
  });
}

/** `POST /clients/{id}/adresses`. */
export function useCreerAdresseClient(
  clientId: string,
): UseMutationResult<ReponseClientAdresse, unknown, EntreeAdresseClient> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entree: EntreeAdresseClient) => {
      const reponse = await requeteApi<ReponseAvecAvertissements<ReponseClientAdresse>>(
        `/clients/${clientId}/adresses`,
        { method: 'POST', body: JSON.stringify(entree) },
      );
      return donneesEcriture(exigerCorps(reponse, `POST /clients/${clientId}/adresses`));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.clients.adresses(clientId) });
    },
  });
}
