import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { clesParametrage } from './cles';
import {
  modifierBlocCreancier,
  type BlocCreancier,
  type EntreeModificationBlocCreancier,
} from './bloc-creancier.api';

/** `PATCH /parametres-facturation/creancier` — pose directement le bloc renvoyé dans le cache
 *  (même principe que `useModifierDocumentVente`) : l'écran n'a jamais à relire après une
 *  écriture réussie. */
export function useModifierBlocCreancier(): UseMutationResult<
  BlocCreancier,
  unknown,
  EntreeModificationBlocCreancier
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeModificationBlocCreancier) => modifierBlocCreancier(entree),
    onSuccess: (bloc) => {
      queryClient.setQueryData(clesParametrage.creancier(), bloc);
    },
  });
}
