import {
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
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { chargeurSousCollectionClient, exigerCorps } from './support';

/** `GET /clients/{id}/adresses` (RM-03, une seule `principale` active à la fois) — onglet
 *  « Adresses » de la fiche. */
export function useAdressesClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientAdresse>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<ReponseClientAdresse>({
    cle: clesQuery.clients.adresses(clientId ?? ''),
    charger: clientId ? chargeurSousCollectionClient(clientId, 'adresses') : undefined,
    reessayer,
  });
  return resultat;
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
