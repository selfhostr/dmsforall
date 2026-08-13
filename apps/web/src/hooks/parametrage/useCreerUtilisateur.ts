import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationUtilisateur, ReponseCreationUtilisateur } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

/**
 * `POST /utilisateurs` — création d'un employé (issue #137). Le serveur génère lui-même le mot
 * de passe temporaire et le rend UNE SEULE FOIS dans `acces.motDePasseTemporaire` : c'est
 * l'écran appelant qui doit l'afficher immédiatement après succès (jamais persisté côté client
 * au-delà de l'affichage — pas de `setQueryData` dessus, pas de log).
 */
export function useCreerUtilisateur(): UseMutationResult<
  ReponseCreationUtilisateur,
  unknown,
  EntreeCreationUtilisateur
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeCreationUtilisateur) =>
      requeteApi<ReponseCreationUtilisateur>('/utilisateurs', {
        method: 'POST',
        body: JSON.stringify(entree),
      }).then((reponse) => {
        if (!reponse) throw new Error('Réponse vide inattendue : POST /utilisateurs.');
        return reponse;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.utilisateurs.liste() });
    },
  });
}
