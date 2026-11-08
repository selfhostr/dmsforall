import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { clesParametrage } from './cles';
import { recupererModules, type ReponseModules } from './modules.api';

/** Réglage Modules (écran Réglages et étape de l'assistant). Le menu, lui, lit `session.modulesActifs`. */
export function useModules(): UseQueryResult<ReponseModules> {
  return useQuery({
    queryKey: clesParametrage.modules(),
    queryFn: recupererModules,
    retry: false,
    staleTime: 60 * 1000,
  });
}
