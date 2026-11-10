import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { EtatInstallation } from '@dfa/shared';

import { recupererEtatInstallation } from '@/api/installation';
import { clesQuery } from '@/api/cles';

/** Public, sans session. Un échec n'est jamais bloquant : l'appelant retombe sur la connexion. */
export function useEtatInstallation(): UseQueryResult<EtatInstallation> {
  return useQuery({
    queryKey: clesQuery.etatInstallation(),
    queryFn: recupererEtatInstallation,
    retry: false,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });
}
