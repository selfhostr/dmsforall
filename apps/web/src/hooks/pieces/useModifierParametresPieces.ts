import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { z } from 'zod';

import { schemaModificationParametresPieces, type ReponseParametresPieces } from '@dfa/shared';

import { requeteApi } from '@/api/client';

import { clesPieces } from './cles';

/** `EntreeModificationParametresPieces` est déjà exporté par `@dfa/shared`, mais réaffirmé ici via
 *  `z.infer` du même schéma — même convention que `useModifierParametresAtelier.ts`. */
export type EntreeModificationParametresPieces = z.infer<typeof schemaModificationParametresPieces>;

async function modifierParametresPieces(
  entree: EntreeModificationParametresPieces,
): Promise<ReponseParametresPieces> {
  const corps = schemaModificationParametresPieces.parse(entree);
  const reponse = await requeteApi<ReponseParametresPieces>('/parametrage/pieces', {
    method: 'PATCH',
    body: JSON.stringify(corps),
  });
  if (!reponse) throw new Error('Réponse vide inattendue : PATCH /parametrage/pieces.');
  return reponse;
}

/**
 * `PATCH /parametrage/pieces` — singleton du tenant, modification PARTIELLE (l'écran envoie
 * toujours l'ensemble des six champs éditables, mais le schéma reste `.optional()`/`.nullish()`
 * pour matcher le contrat serveur). Pose directement la réponse dans le cache (`setQueryData`),
 * même geste que `useModifierParametresAtelier` : l'écran n'a jamais à relire après une écriture
 * réussie.
 */
export function useModifierParametresPieces(): UseMutationResult<
  ReponseParametresPieces,
  unknown,
  EntreeModificationParametresPieces
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeModificationParametresPieces) => modifierParametresPieces(entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.parametrage(), reponse);
    },
  });
}
