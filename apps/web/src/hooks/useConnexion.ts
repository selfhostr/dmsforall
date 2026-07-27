import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router';

import type { EntreeConnexion, SessionCourante } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { connecter } from '@/api/session';

interface EtatNavigation {
  readonly from?: string;
}

/** Ordre impératif pour la sécurité multi-tenant : `clear()` PUIS remplissage du cache PUIS
 *  navigation. `clear()` d'abord garantit qu'aucun résidu de cache d'un tenant précédent
 *  (poste partagé d'atelier) ne survit à une nouvelle connexion. */
export function useConnexion(): UseMutationResult<SessionCourante, unknown, EntreeConnexion> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();

  return useMutation({
    mutationFn: (entree: EntreeConnexion) => connecter(entree),
    onSuccess: async (session) => {
      queryClient.clear();
      await queryClient.fetchQuery({
        queryKey: clesQuery.session(),
        queryFn: () => Promise.resolve(session),
      });
      const etat = location.state as EtatNavigation | null;
      navigate(etat?.from ?? '/', { replace: true });
    },
  });
}
