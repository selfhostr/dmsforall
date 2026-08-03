import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationArticle, ReponseArticle, ReponseAvecAvertissements } from '@dfa/shared';

import { creerArticle } from './articles.api';

interface VariablesCreationArticle {
  readonly entree: EntreeCreationArticle;
  /** Générée par `useCleIdempotence` au montage du formulaire (RP-08 : un rejeu ne doit jamais
   *  brûler un `numeroArticle`). */
  readonly idempotencyKey: string;
}

/** `POST /articles` — même patron que `useCreerClient` : invalidation par PRÉFIXE de la liste
 *  (toute variante de filtre/tri), pas de préremplissage de la fiche (jamais visitée). */
export function useCreerArticle(): UseMutationResult<
  ReponseAvecAvertissements<ReponseArticle>,
  unknown,
  VariablesCreationArticle
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationArticle) =>
      creerArticle(entree, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'liste'] });
    },
  });
}
