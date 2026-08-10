import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationLigneDocument, ReponseDocumentVente } from '@dfa/shared';

import { clesFacturation } from './cles';
import { ajouterLigneDocument, supprimerLigneDocument } from './documents-vente.api';

interface VariablesAjoutLigne {
  readonly documentId: string;
  readonly entree: EntreeCreationLigneDocument;
  readonly idempotencyKey: string;
}

/** `POST /documents-vente/{id}/lignes` — écran 2 §4.3 (rattrapage de la ligne de démontage
 *  proposée si elle n'a pas été ajoutée à l'écran 1). */
export function useAjouterLigneDocument(): UseMutationResult<
  ReponseDocumentVente,
  unknown,
  VariablesAjoutLigne
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, entree, idempotencyKey }: VariablesAjoutLigne) =>
      ajouterLigneDocument(documentId, entree, idempotencyKey),
    onSuccess: (document) => {
      queryClient.setQueryData(clesFacturation.documents.detail(document.id), document);
    },
  });
}

interface VariablesSuppressionLigne {
  readonly documentId: string;
  readonly ligneId: string;
}

/** Retrait d'une ligne ajoutée par erreur en facturation (§4.3) — jamais une ligne recopiée d'un
 *  OR. Le verbe `DELETE` est confirmé par le contrat régénéré (voir la note de fraîcheur en tête de
 *  `documents-vente.api.ts`) — reste vrai en revanche : ni ce hook ni `useAjouterLigneDocument`
 *  ci-dessus n'ont d'appelant dans `apps/web/src/ecrans/**` à ce jour. */
export function useSupprimerLigneDocument(): UseMutationResult<
  ReponseDocumentVente,
  unknown,
  VariablesSuppressionLigne
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, ligneId }: VariablesSuppressionLigne) =>
      supprimerLigneDocument(documentId, ligneId),
    onSuccess: (document) => {
      queryClient.setQueryData(clesFacturation.documents.detail(document.id), document);
    },
  });
}
