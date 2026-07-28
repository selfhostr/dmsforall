import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseClient } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

import { exigerCorps } from './support';

/** `GET /clients/{id}` — répond `200` même sur une fiche fusionnée (`fusionneVersClientId` non
 *  `null`, RM-06) : ne jamais traiter un client absorbé comme une erreur 404 côté écran.
 *
 *  `ReponseClient.notesAlerte` (RM-13) embarque les notes de nature `alerte` directement dans
 *  cette réponse — `BandeauAlerteClient` les consomme telles quelles, sans appel réseau séparé. */
export function useClient(id: string | undefined): UseQueryResult<ReponseClient> {
  return useQuery({
    queryKey: clesQuery.clients.detail(id ?? ''),
    queryFn: async () => {
      const client = await requeteApi<ReponseClient>(`/clients/${id}`, { method: 'GET' });
      return exigerCorps(client, `GET /clients/${id ?? ''}`);
    },
    enabled: Boolean(id),
  });
}
