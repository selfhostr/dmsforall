import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { EntreeChangementMotDePasse } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { changerMotDePasse } from '@/api/session';

/** Issue #58 : après le changement, la session est relue (le drapeau `motDePasseAChanger` tombe)
 *  puis la personne entre dans l'application. */
export function useChangerMotDePasse(): UseMutationResult<
  void,
  unknown,
  EntreeChangementMotDePasse
> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: changerMotDePasse,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: clesQuery.session() });
      navigate('/', { replace: true });
    },
  });
}
