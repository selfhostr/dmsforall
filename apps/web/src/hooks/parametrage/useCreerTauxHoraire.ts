import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationTauxHoraire, ReponseTauxHoraire } from '@dfa/shared';

import { clesParametrage } from './cles';
import { creerTauxHoraire } from './taux-horaires.api';

/** `POST /referentiels/taux-horaires` — invalide la liste entière (préfixe de clé, pas de
 *  variante de filtre ici) plutôt qu'un `setQueryData` local : la nouvelle période peut modifier
 *  l'ordre/la pagination de la page déjà en cache. */
export function useCreerTauxHoraire(): UseMutationResult<ReponseTauxHoraire, unknown, EntreeCreationTauxHoraire> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeCreationTauxHoraire) => creerTauxHoraire(entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesParametrage.tauxHoraires.liste() });
    },
  });
}
