import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeArreterContactClient,
  EntreeReprendreContactClient,
  ReponseAvecAvertissements,
  ReponseClient,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { donneesEcriture } from '@/api/enveloppe';

/**
 * `POST /clients/{id}/arreter-contact` / `.../reprendre-contact` (RA-14, issue #133) — la
 * fiche client expose déjà `plusAucunContact`/`motif` (`ReponseClient`) et les deux routes sont
 * câblées côté serveur (`ClientController.arreterContact`/`.reprendreContact`,
 * `motif` obligatoire des deux côtés) ; jusqu'ici aucun écran ne les appelait — seul un
 * contournement en note libre existait, invisible pour une purge marketing automatisée. Les deux
 * mutations pose directement la fiche à jour dans le cache (même patron que
 * `useModifierBlocCreancier`) : la réponse est déjà la ressource complète, inutile de la relire.
 */
export function useArreterContactClient(
  clientId: string,
): UseMutationResult<ReponseClient, unknown, EntreeArreterContactClient> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entree: EntreeArreterContactClient) => {
      const reponse = await requeteApi<ReponseAvecAvertissements<ReponseClient>>(
        `/clients/${clientId}/arreter-contact`,
        { method: 'POST', body: JSON.stringify(entree) },
      );
      if (!reponse) {
        throw new Error(`Réponse vide inattendue : POST /clients/${clientId}/arreter-contact.`);
      }
      return donneesEcriture(reponse);
    },
    onSuccess: (client) => {
      queryClient.setQueryData(clesQuery.clients.detail(clientId), client);
    },
  });
}

export function useReprendreContactClient(
  clientId: string,
): UseMutationResult<ReponseClient, unknown, EntreeReprendreContactClient> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entree: EntreeReprendreContactClient) => {
      const reponse = await requeteApi<ReponseAvecAvertissements<ReponseClient>>(
        `/clients/${clientId}/reprendre-contact`,
        { method: 'POST', body: JSON.stringify(entree) },
      );
      if (!reponse) {
        throw new Error(`Réponse vide inattendue : POST /clients/${clientId}/reprendre-contact.`);
      }
      return donneesEcriture(reponse);
    },
    onSuccess: (client) => {
      queryClient.setQueryData(clesQuery.clients.detail(clientId), client);
    },
  });
}
