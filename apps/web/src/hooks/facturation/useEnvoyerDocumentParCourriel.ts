import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import {
  envoyerDocumentParCourriel,
  type ReponseEnvoiCourrielDocument,
} from './pdf-courriel-document.api';

/** `POST /documents-vente/{id}/envoyer-courriel`. */
export function useEnvoyerDocumentParCourriel(): UseMutationResult<
  ReponseEnvoiCourrielDocument,
  unknown,
  string
> {
  return useMutation({ mutationFn: (id: string) => envoyerDocumentParCourriel(id) });
}
