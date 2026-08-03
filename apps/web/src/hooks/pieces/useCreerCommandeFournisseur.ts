import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationCommandeFournisseur,
  ReponseAvecAvertissements,
  ReponseCommandeFournisseur,
} from '@dfa/shared';

import { creerCommandeFournisseur } from './commandes-fournisseur.api';

interface VariablesCreationCommandeFournisseur {
  readonly entree: EntreeCreationCommandeFournisseur;
  /** Générée par `useCleIdempotence` au montage de l'écran de création (création sensible). */
  readonly idempotencyKey: string;
}

/** `POST /commandes-fournisseur` — même patron que `useCreerArticle` : invalidation par PRÉFIXE de
 *  la liste, pas de préremplissage de la fiche (jamais visitée avant la navigation qui suit). */
export function useCreerCommandeFournisseur(): UseMutationResult<
  ReponseAvecAvertissements<ReponseCommandeFournisseur>,
  unknown,
  VariablesCreationCommandeFournisseur
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationCommandeFournisseur) =>
      creerCommandeFournisseur(entree, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'commandesFournisseur', 'liste'] });
    },
  });
}
