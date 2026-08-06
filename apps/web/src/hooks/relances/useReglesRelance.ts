import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseRegleRelance } from '@dfa/shared';

import { clesRelances } from './cles';
import { listerReglesRelance } from './relances.api';

/**
 * `GET /relances/regles` — configuration des rappels par type (lot 1 : seul `facture_echue` a un
 * moteur d'envoi). `staleTime` long : un réglage de relance change rarement en cours de service,
 * même convention que `useParametresPieces`.
 */
export function useReglesRelance(): UseQueryResult<readonly ReponseRegleRelance[]> {
  return useQuery({
    queryKey: clesRelances.regles(),
    queryFn: listerReglesRelance,
    staleTime: 5 * 60 * 1000,
  });
}
