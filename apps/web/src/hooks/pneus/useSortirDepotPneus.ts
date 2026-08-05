import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeSortieDepotPneus, ReponseDepotPneus } from '@dfa/shared';

import { sortirDepotPneus } from './depot-pneus.api';

interface VariablesSortieDepotPneus {
  readonly id: string;
  readonly entree: EntreeSortieDepotPneus;
}

/** `POST /depots-pneus/{id}/sortir` (RPP-05) — statut TERMINAL, motif obligatoire. */
export function useSortirDepotPneus(): UseMutationResult<
  ReponseDepotPneus,
  unknown,
  VariablesSortieDepotPneus
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree }: VariablesSortieDepotPneus) => sortirDepotPneus(id, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pneus'] });
    },
  });
}
