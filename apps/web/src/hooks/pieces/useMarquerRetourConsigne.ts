import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseConsigneEchangeStandard } from '@dfa/shared';

import { marquerRetourFournisseurConsigne } from './consignes.api';

/** `POST /consignes/{id}/marquer-retour-fournisseur` (RP-40) — génère le mouvement
 *  `retour_consigne` : invalide la liste des consignes ET le référentiel article (mouvements),
 *  même doctrine que `useSatisfaireReservation`. */
export function useMarquerRetourConsigne(): UseMutationResult<
  ReponseConsigneEchangeStandard,
  unknown,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => marquerRetourFournisseurConsigne(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'consignes', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'mouvements'] });
    },
  });
}
