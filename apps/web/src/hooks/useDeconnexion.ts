import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { deconnecter } from '@/api/session';

/** Purge + redirection en `onSettled` (succès OU échec réseau) : sur une tablette d'atelier
 *  partagée, rester connecté parce que le serveur n'a pas répondu est pire que tout. */
export function useDeconnexion(): UseMutationResult<void, unknown, void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: deconnecter,
    onSettled: () => {
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });
}
