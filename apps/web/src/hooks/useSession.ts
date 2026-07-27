import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { SessionCourante } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { recupererSessionCourante } from '@/api/session';

/** `data === null` -> non connecté (redirection login) ; `isError` -> service indisponible
 *  (JAMAIS l'écran de login) ; `isPending` -> vérification en cours. `retry:false` car un 401
 *  est une donnée stable, pas un échec transitoire à retenter. */
export function useSession(): UseQueryResult<SessionCourante | null> {
  return useQuery({
    queryKey: clesQuery.session(),
    queryFn: recupererSessionCourante,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });
}
