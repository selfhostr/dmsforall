import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { clesQuery } from '@/api/cles';

import { clesParametrage } from './cles';
import {
  modifierModules,
  type EntreeModificationModules,
  type ReponseModules,
} from './modules.api';

/**
 * Enregistre les modules retirés. La session est invalidée : menus, routes et raccourcis lisent
 * `session.modulesActifs`, ils doivent suivre sans rechargement de la page.
 */
export function useModifierModules(): UseMutationResult<
  ReponseModules,
  unknown,
  EntreeModificationModules
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: modifierModules,
    meta: { succes: 'parametrage:modules.toast.enregistre' },
    onSuccess: async (reponse) => {
      queryClient.setQueryData(clesParametrage.modules(), reponse);
      await queryClient.invalidateQueries({ queryKey: clesQuery.session() });
    },
  });
}
