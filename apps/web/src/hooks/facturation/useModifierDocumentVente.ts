import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeModificationDocumentVente, ReponseDocumentVente } from '@dfa/shared';

import { clesFacturation } from './cles';
import { modifierDocumentVente } from './documents-vente.api';

interface VariablesModification {
  readonly id: string;
  readonly entree: EntreeModificationDocumentVente;
  readonly etag: string | null;
}

/** `PATCH /documents-vente/{id}` — brouillon uniquement (écran 2 §4.2 destinataire, §4.4 remise
 *  globale). Pose directement le document renvoyé dans le cache. */
export function useModifierDocumentVente(): UseMutationResult<
  ReponseDocumentVente,
  unknown,
  VariablesModification
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree, etag }: VariablesModification) =>
      modifierDocumentVente(id, entree, etag),
    onSuccess: (document) => {
      queryClient.setQueryData(clesFacturation.documents.detail(document.id), document);
    },
  });
}
