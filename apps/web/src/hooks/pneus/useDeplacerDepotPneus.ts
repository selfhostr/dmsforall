import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeDeplacementDepotPneus, ReponseDepotPneus } from '@dfa/shared';

import { deplacerDepotPneus } from './depot-pneus.api';

interface VariablesDeplacementDepotPneus {
  readonly id: string;
  readonly entree: EntreeDeplacementDepotPneus;
}

/** `POST /depots-pneus/{id}/deplacer` (défaut n°2, RPP-07) — même invalidation large (`['pneus']`)
 *  que `useChangerSaisonDepotPneus`/`useSortirDepotPneus` : le plan du hangar ET les résultats de
 *  recherche affichent le nouveau `codeCase` dès la réponse. */
export function useDeplacerDepotPneus(): UseMutationResult<
  ReponseDepotPneus,
  unknown,
  VariablesDeplacementDepotPneus
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree }: VariablesDeplacementDepotPneus) => deplacerDepotPneus(id, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pneus'] });
    },
  });
}
