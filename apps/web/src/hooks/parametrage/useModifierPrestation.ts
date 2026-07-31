import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponsePrestation } from '@dfa/shared';

import { clesParametrage } from './cles';
import { modifierPrestation, type EntreeModificationPrestation } from './prestations.api';

interface VariablesModificationPrestation {
  readonly id: string;
  readonly entree: EntreeModificationPrestation;
}

/** `PATCH /referentiels/prestations/{id}` — invalide le catalogue entier. */
export function useModifierPrestation(): UseMutationResult<ReponsePrestation, unknown, VariablesModificationPrestation> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree }: VariablesModificationPrestation) => modifierPrestation(id, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesParametrage.prestations.liste() });
    },
  });
}
