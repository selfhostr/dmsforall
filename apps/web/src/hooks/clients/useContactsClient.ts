import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import type {
  EntreeContactClient,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseClientContact,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { donneesEcriture } from '@/api/enveloppe';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { chargeurSousCollectionClient, exigerCorps } from './support';

/** `GET /clients/{id}/contacts` (RM-04, rôles cumulables) — onglet « Contacts » de la fiche.
 *  Pagination par curseur v1 (`creeLe desc, id desc`), pas de `tri` exposé au contrat. */
export function useContactsClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientContact>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<ReponseClientContact>({
    cle: clesQuery.clients.contacts(clientId ?? ''),
    charger: clientId ? chargeurSousCollectionClient(clientId, 'contacts') : undefined,
    reessayer,
  });
  return resultat;
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
