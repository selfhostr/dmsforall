import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeModificationUtilisateur, UtilisateurResume } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

interface VariablesModificationUtilisateur {
  readonly utilisateurId: string;
  readonly entree: EntreeModificationUtilisateur;
}

/** `PATCH /utilisateurs/{id}` — changer le rôle et/ou les sites d'un employé. Promouvoir vers
 *  `admin` reste refusé côté serveur (403) à quiconque n'est pas déjà admin, quel que soit ce que
 *  l'écran propose — voir `RoleUtilisateur` limité côté écran, `EcranUtilisateurs.tsx`. */
export function useModifierUtilisateur(): UseMutationResult<
  UtilisateurResume,
  unknown,
  VariablesModificationUtilisateur
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ utilisateurId, entree }: VariablesModificationUtilisateur) =>
      requeteApi<UtilisateurResume>(`/utilisateurs/${utilisateurId}`, {
        method: 'PATCH',
        body: JSON.stringify(entree),
      }).then((reponse) => {
        if (!reponse)
          throw new Error(`Réponse vide inattendue : PATCH /utilisateurs/${utilisateurId}.`);
        return reponse;
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesQuery.utilisateurs.liste() });
    },
  });
}
