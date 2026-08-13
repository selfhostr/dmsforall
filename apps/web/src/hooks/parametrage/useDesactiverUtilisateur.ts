import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { UtilisateurResume } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

/** `POST /utilisateurs/{id}/desactiver` — jamais une suppression : l'historique (OR, factures,
 *  pointages) reste attribuable. Refusé (409) sur son propre compte. */
export function useDesactiverUtilisateur(): UseMutationResult<UtilisateurResume, unknown, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (utilisateurId: string) =>
      requeteApi<UtilisateurResume>(`/utilisateurs/${utilisateurId}/desactiver`, {
        method: 'POST',
      }).then((reponse) => {
        if (!reponse)
          throw new Error(
            `Réponse vide inattendue : POST /utilisateurs/${utilisateurId}/desactiver.`,
          );
        return reponse;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.utilisateurs.liste() });
    },
  });
}
