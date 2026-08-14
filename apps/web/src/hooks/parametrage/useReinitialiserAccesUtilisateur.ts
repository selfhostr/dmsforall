import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseAccesTemporaire } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/** `POST /utilisateurs/{id}/reinitialiser-acces` — nouveau mot de passe temporaire, rendu UNE
 *  SEULE FOIS dans la réponse. N'invalide aucun cache (n'affecte ni la liste ni le résumé
 *  affiché — seul le secret change, jamais montré ailleurs qu'à l'instant de l'appel). */
export function useReinitialiserAccesUtilisateur(): UseMutationResult<
  ReponseAccesTemporaire,
  unknown,
  string
> {
  return useMutation({
    mutationFn: (utilisateurId: string) =>
      requeteApi<ReponseAccesTemporaire>(`/utilisateurs/${utilisateurId}/reinitialiser-acces`, {
        method: 'POST',
      }).then((reponse) => {
        if (!reponse)
          throw new Error(
            `Réponse vide inattendue : POST /utilisateurs/${utilisateurId}/reinitialiser-acces.`,
          );
        return reponse;
      }),
  });
}
