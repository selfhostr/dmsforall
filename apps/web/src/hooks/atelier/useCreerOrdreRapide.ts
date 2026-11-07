import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationRapideOrdreReparation,
  ReponseAvecAvertissements,
  ReponseCreationRapideOrdreReparation,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';

interface VariablesCreationRapide {
  readonly entree: EntreeCreationRapideOrdreReparation;
  readonly idempotencyKey: string;
}

/** `POST /ordres-reparation/creation-rapide` — (client) + (véhicule) + OR en une transaction. */
export function useCreerOrdreRapide(): UseMutationResult<
  ReponseAvecAvertissements<ReponseCreationRapideOrdreReparation>,
  unknown,
  VariablesCreationRapide
> {
  const queryClient = useQueryClient();

  return useMutation({
    meta: { succes: 'commun:toasts.orCree' },
    mutationFn: async ({ entree, idempotencyKey }: VariablesCreationRapide) => {
      const reponse = await requeteApi<
        ReponseAvecAvertissements<ReponseCreationRapideOrdreReparation>
      >('/ordres-reparation/creation-rapide', {
        method: 'POST',
        body: JSON.stringify(entree),
        idempotencyKey,
      });
      if (!reponse)
        throw new Error('Réponse vide inattendue : POST /ordres-reparation/creation-rapide.');
      return reponse;
    },
    onSuccess: (reponse) => {
      const { ordreReparation, client } = reponse.donnees;
      queryClient.setQueryData(clesQuery.or.detail(ordreReparation.id), ordreReparation);
      void queryClient.invalidateQueries({ queryKey: ['or', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: ['clients', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: ['vehicules'] });
      void queryClient.invalidateQueries({ queryKey: clesQuery.clients.ordres(client.id) });
    },
  });
}
