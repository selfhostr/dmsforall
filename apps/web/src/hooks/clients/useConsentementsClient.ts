import {
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
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { chargeurSousCollectionClient, exigerCorps } from './support';

/** `GET /clients/{id}/consentements` (RM-09, nLPD, APPEND-ONLY) — onglet « Consentements » de la
 *  fiche. Aucun `PATCH`/`DELETE` : une révocation est une nouvelle ligne `accorde: false`. */
export function useConsentementsClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientConsentement>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<ReponseClientConsentement>({
    cle: clesQuery.clients.consentements(clientId ?? ''),
    charger: clientId ? chargeurSousCollectionClient(clientId, 'consentements') : undefined,
    reessayer,
  });
  return resultat;
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
