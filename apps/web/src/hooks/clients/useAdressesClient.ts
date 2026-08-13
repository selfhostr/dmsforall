import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';

import type { z } from 'zod';

import type {
  schemaModificationAdresseClient,
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

/**
 * `PATCH /clients/{clientId}/adresses/{adresseId}` (issue #131) — le schéma serveur
 * (`schemaModificationAdresseClient`, `@dfa/shared`) existe et la route est câblée
 * (`ClientAdresseController.modifier`), mais `@dfa/shared` n'exporte QUE le schéma, pas de type
 * `z.infer` associé (contrairement à `EntreeAdresseClient` ci-dessus) — dérivé ICI depuis le
 * schéma réellement importé, jamais retapé à la main (règle du dépôt : aucun type serveur
 * redéfini). GAP DE CONTRAT mineur à signaler : `EntreeModificationAdresseClient` devrait à terme
 * vivre dans `@dfa/shared`, au même titre que ses cinq voisins `EntreeModification*`.
 */
export type EntreeModificationAdresseClient = z.infer<typeof schemaModificationAdresseClient>;

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

interface VariablesModificationAdresse {
  readonly adresseId: string;
  readonly entree: EntreeModificationAdresseClient;
}

/** `PATCH /clients/{id}/adresses/{adresseId}` (issue #131 — jusque-là aucun geste de
 *  modification côté écran alors que la route existe). Invalide la même clé que
 *  `useCreerAdresseClient` : l'onglet « Adresses » relit la liste, aucune raison de diverger sur
 *  ce point entre création et modification. */
export function useModifierAdresseClient(
  clientId: string,
): UseMutationResult<ReponseClientAdresse, unknown, VariablesModificationAdresse> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ adresseId, entree }: VariablesModificationAdresse) => {
      const reponse = await requeteApi<ReponseAvecAvertissements<ReponseClientAdresse>>(
        `/clients/${clientId}/adresses/${adresseId}`,
        { method: 'PATCH', body: JSON.stringify(entree) },
      );
      return donneesEcriture(
        exigerCorps(reponse, `PATCH /clients/${clientId}/adresses/${adresseId}`),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.clients.adresses(clientId) });
    },
  });
}
