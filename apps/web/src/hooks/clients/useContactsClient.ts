import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import type { EntreeContactClient, PageCurseur, ReponseAvecAvertissements, ReponseClientContact } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { donneesEcriture } from '@/api/enveloppe';

import { construireRequete, exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

/** `GET /clients/{id}/contacts` (RM-04, rôles cumulables) — onglet « Contacts » de la fiche.
 *  Pagination par curseur v1 (`creeLe desc, id desc`), pas de `tri` exposé au contrat. */
export function useContactsClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientContact>>, unknown> {
  return useInfiniteQuery({
    queryKey: clesQuery.clients.contacts(clientId ?? ''),
    queryFn: async ({ pageParam }) => {
      const params = construireRequete({ limite: LIMITE_PAR_PAGE, curseur: pageParam ?? undefined });
      const page = await requeteApi<PageCurseur<ReponseClientContact>>(
        `/clients/${clientId}/contacts?${params.toString()}`,
        { method: 'GET' },
      );
      return exigerCorps(page, `GET /clients/${clientId ?? ''}/contacts`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant,
    enabled: Boolean(clientId),
  });
}

/** `POST /clients/{id}/contacts`. */
export function useCreerContactClient(
  clientId: string,
): UseMutationResult<ReponseClientContact, unknown, EntreeContactClient> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entree: EntreeContactClient) => {
      const reponse = await requeteApi<ReponseAvecAvertissements<ReponseClientContact>>(
        `/clients/${clientId}/contacts`,
        { method: 'POST', body: JSON.stringify(entree) },
      );
      return donneesEcriture(exigerCorps(reponse, `POST /clients/${clientId}/contacts`));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.clients.contacts(clientId) });
    },
  });
}
