import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseIdentificationPin } from '@dfa/shared';

import { identifierParPin } from './pin.api';

/**
 * `POST /pointages/identification` — reconnaît un technicien par son PIN sur la borne. PAS
 * d'invalidation ni de cache TanStack Query pertinent ici : la réponse n'ouvre aucune session et
 * ne modifie aucune ressource serveur (voir l'en-tête de `pin.api.ts`) — `useMutation` ne sert
 * qu'à porter `isPending`/l'erreur typée pour l'écran, sans les `onMutate`/`onSuccess` optimistes
 * de `useDemarrerPointage` (rien à réconcilier dans un cache).
 *
 * Variable de mutation = le code PIN lui-même (`string`) : APPELÉ UNE SEULE FOIS par tentative,
 * jamais conservé après (l'écran efface son état local dès la réponse, succès ou échec — voir
 * `EcranBornePointage.tsx`).
 */
export function useIdentificationPin(): UseMutationResult<
  ReponseIdentificationPin,
  unknown,
  string
> {
  return useMutation({
    mutationFn: (codePin: string) => identifierParPin(codePin),
  });
}
