import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationDepotPneus, ReponseDepotPneus } from '@dfa/shared';

import { creerDepotPneus } from './depot-pneus.api';

interface VariablesCreationDepotPneus {
  readonly vehiculeId: string;
  readonly entree: EntreeCreationDepotPneus;
  readonly idempotencyKey: string;
}

/** `POST /vehicules/{id}/depots-pneus` (RPP-01/RPP-02) — invalide le hangar du site visé et
 *  l'historique du véhicule : préfixe large (`['pneus']`) plutôt qu'une clé précise, même doctrine
 *  que `useSatisfaireReservation` (le formulaire de création ne connaît pas forcément tous les
 *  filtres actifs sur l'écran hangar au moment de la soumission). */
export function useCreerDepotPneus(): UseMutationResult<
  ReponseDepotPneus,
  unknown,
  VariablesCreationDepotPneus
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ vehiculeId, entree, idempotencyKey }: VariablesCreationDepotPneus) =>
      creerDepotPneus(vehiculeId, entree, idempotencyKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pneus'] });
    },
  });
}
