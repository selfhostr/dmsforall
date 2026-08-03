import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeDeverrouillagePeriodePointage,
  EntreeVerrouillagePeriodePointage,
  ReponseDeverrouillagePeriodePointage,
  ReponseVerrouillagePeriodePointage,
} from '@dfa/shared';

import { deverrouillerPeriodePointage, verrouillerPeriodePointage } from './pointage.api';

/** `POST /pointages/verrouiller-periode` — RM-95. Pas d'`Idempotency-Key` (voir l'en-tête de
 *  `periode.ts` : re-verrouiller une période déjà verrouillée est un NO-OP naturel, `pointages
 *  Verrouilles` vaut alors 0 sur un rejeu). Invalide la liste par PRÉFIXE : tout pointage affiché
 *  peut avoir changé de `statut` en lot. */
export function useVerrouillerPeriodePointage(): UseMutationResult<
  ReponseVerrouillagePeriodePointage,
  unknown,
  EntreeVerrouillagePeriodePointage
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: verrouillerPeriodePointage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pointages'] });
    },
  });
}

/** `POST /pointages/deverrouiller-periode` — contre-passation, motif obligatoire (porté par
 *  l'écran, pas par ce hook). Même invalidation large que le verrouillage. */
export function useDeverrouillerPeriodePointage(): UseMutationResult<
  ReponseDeverrouillagePeriodePointage,
  unknown,
  EntreeDeverrouillagePeriodePointage
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deverrouillerPeriodePointage,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pointages'] });
    },
  });
}
