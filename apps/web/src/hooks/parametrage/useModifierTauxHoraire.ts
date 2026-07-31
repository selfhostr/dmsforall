import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseTauxHoraire } from '@dfa/shared';

import { clesParametrage } from './cles';
import { modifierTauxHoraire, type EntreeModificationTauxHoraire } from './taux-horaires.api';

interface VariablesModificationTauxHoraire {
  readonly id: string;
  readonly entree: EntreeModificationTauxHoraire;
}

/** `PATCH /referentiels/taux-horaires/{id}` — invalide la liste (une modification de montant ou
 *  de bornes de validité peut changer l'ordre affiché, jamais assez fréquent pour justifier un
 *  `setQueryData` ligne par ligne dans une page potentiellement absente du cache courant). */
export function useModifierTauxHoraire(): UseMutationResult<ReponseTauxHoraire, unknown, VariablesModificationTauxHoraire> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree }: VariablesModificationTauxHoraire) => modifierTauxHoraire(id, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesParametrage.tauxHoraires.liste() });
    },
  });
}
