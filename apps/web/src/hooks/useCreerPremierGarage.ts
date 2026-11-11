import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import type { EntreePremierGarage, SessionCourante } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { creerPremierGarage } from '@/api/installation';

/** Même ordre que `useConnexion` : `clear()` PUIS cache de session PUIS navigation. L'état
 *  d'installation passe à « fait » pour que `/login` ne renvoie pas ici. */
export function useCreerPremierGarage(): UseMutationResult<
  SessionCourante,
  unknown,
  EntreePremierGarage
> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  return useMutation({
    mutationFn: creerPremierGarage,
    onSuccess: async (session) => {
      queryClient.clear();
      queryClient.setQueryData(clesQuery.etatInstallation(), { premierGarageRequis: false });
      await queryClient.fetchQuery({
        queryKey: clesQuery.session(),
        queryFn: () => Promise.resolve(session),
      });
      navigate('/', { replace: true });
    },
  });
}
