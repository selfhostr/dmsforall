import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeChangementSaisonDepotPneus, ReponseDepotPneus } from '@dfa/shared';

import { changerSaisonDepotPneus } from './depot-pneus.api';

interface VariablesChangementSaison {
  readonly id: string;
  readonly entree: EntreeChangementSaisonDepotPneus;
}

/** `POST /depots-pneus/{id}/changer-saison` (RPP-03) — inverse le jeu visé ET son jumeau actif :
 *  invalidation large (`['pneus']`), le jumeau n'est pas forcément connu de l'appelant. */
export function useChangerSaisonDepotPneus(): UseMutationResult<
  ReponseDepotPneus,
  unknown,
  VariablesChangementSaison
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree }: VariablesChangementSaison) => changerSaisonDepotPneus(id, entree),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pneus'] });
    },
  });
}
