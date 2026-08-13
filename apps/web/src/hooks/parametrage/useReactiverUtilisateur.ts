import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { UtilisateurResume } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

/** `POST /utilisateurs/{id}/reactiver` — annule une désactivation. */
export function useReactiverUtilisateur(): UseMutationResult<UtilisateurResume, unknown, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (utilisateurId: string) =>
      requeteApi<UtilisateurResume>(`/utilisateurs/${utilisateurId}/reactiver`, {
        method: 'POST',
      }).then((reponse) => {
        if (!reponse)
          throw new Error(
            `Réponse vide inattendue : POST /utilisateurs/${utilisateurId}/reactiver.`,
          );
        return reponse;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.utilisateurs.liste() });
    },
  });
}
