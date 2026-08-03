import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationFournisseur,
  ReponseAvecAvertissements,
  ReponseFournisseur,
} from '@dfa/shared';

import { creerFournisseur } from './fournisseurs.api';

/** `POST /fournisseurs` — même patron que `useCreerArticle` : invalidation par PRÉFIXE de la
 *  liste. Pas d'`Idempotency-Key` (aucune numérotation serveur). */
export function useCreerFournisseur(): UseMutationResult<
  ReponseAvecAvertissements<ReponseFournisseur>,
  unknown,
  EntreeCreationFournisseur
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeCreationFournisseur) => creerFournisseur(entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'fournisseurs', 'liste'] });
    },
  });
}
