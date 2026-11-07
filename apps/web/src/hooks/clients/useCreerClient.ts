import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationClient, ReponseAvecAvertissements, ReponseClient } from '@dfa/shared';

import { requeteApi } from '@/api/client';

interface VariablesCreationClient {
  readonly entree: EntreeCreationClient;
  /** Générée par `useCleIdempotence` au montage du formulaire (RM-11 : un rejeu ne doit jamais
   *  brûler un numéro de client). Régénérer AVANT un rejeu qui ajoute `confirmations[]`
   *  (`entree.confirmations`) — voir `api/idempotence.ts`. */
  readonly idempotencyKey: string;
}

/**
 * `POST /clients` — l'avertissement `CLIENT_DOUBLON_PROBABLE` voyage dans `avertissements[]`
 * d'une réponse `2xx` (jamais un refus, CT-01) : cette mutation RÉUSSIT même quand un doublon est
 * détecté côté serveur. L'écran appelant décide de la confirmation AVANT soumission (aperçu via
 * `useDoublonsClients` + `AvertissementConfirmable`, jamais un blocage après coup) — voir
 * `FormulaireNouveauClient`.
 */
export function useCreerClient(): UseMutationResult<
  ReponseAvecAvertissements<ReponseClient>,
  unknown,
  VariablesCreationClient
> {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { succes: 'commun:toasts.clientCree' },
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationClient) =>
      requeteApi<ReponseAvecAvertissements<ReponseClient>>('/clients', {
        method: 'POST',
        body: JSON.stringify(entree),
        idempotencyKey,
      }).then((reponse) => {
        if (!reponse) throw new Error('Réponse vide inattendue : POST /clients.');
        return reponse;
      }),
    onSuccess: () => {
      // Préfixe seul (pas `clesQuery.clients.liste(...)` d'un filtre précis) : une création doit
      // invalider TOUTE variante de filtre/tri de la liste, pas seulement celle affichée à cet
      // instant (§5.3 de l'en-tête de `cles.ts`). Pas de `setQueryData` sur `clients.detail` : la
      // fiche du client fraîchement créé n'a jamais été visitée, rien à préremplir.
      void queryClient.invalidateQueries({ queryKey: ['clients', 'liste'] });
    },
  });
}
