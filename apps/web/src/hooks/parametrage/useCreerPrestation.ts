import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationPrestation, ReponsePrestation } from '@dfa/shared';

import { clesParametrage } from './cles';
import { creerPrestation } from './prestations.api';

/** `POST /referentiels/prestations` — invalide le catalogue entier (même raisonnement que
 *  `useCreerTauxHoraire` : l'ordre d'une page déjà en cache peut changer). */
export function useCreerPrestation(): UseMutationResult<
  ReponsePrestation,
  unknown,
  EntreeCreationPrestation
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeCreationPrestation) => creerPrestation(entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesParametrage.prestations.liste() });
    },
  });
}
