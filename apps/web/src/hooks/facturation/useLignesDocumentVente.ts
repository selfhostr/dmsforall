import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationLigneDocument,
  EntreeModificationLigneDocument,
  ReponseDocumentVente,
} from '@dfa/shared';

import { clesFacturation } from './cles';
import {
  ajouterLigneDocument,
  modifierLigneDocument,
  supprimerLigneDocument,
} from './documents-vente.api';

interface VariablesAjoutLigne {
  readonly documentId: string;
  readonly entree: EntreeCreationLigneDocument;
  readonly idempotencyKey: string;
}

/** `POST /documents-vente/{id}/lignes` — écran 2 §4.3 (rattrapage de la ligne de démontage
 *  proposée si elle n'a pas été ajoutée à l'écran 1), et depuis l'issue #125 l'ajout générique de
 *  ligne sur un brouillon (`DialogueLigneDocumentVente.tsx`). */
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

interface VariablesModificationLigne {
  readonly documentId: string;
  readonly ligneId: string;
  readonly entree: EntreeModificationLigneDocument;
}

/** `PATCH /documents-vente/{id}/lignes/{ligneId}` — édition d'une ligne sur un brouillon (issue
 *  #125, `DialogueLigneDocumentVente.tsx`). Même doctrine de cache que les deux mutations
 *  ci-dessus : le document COMPLET revient dans la réponse, posé directement en cache plutôt
 *  qu'une invalidation (pas de round-trip GET supplémentaire après chaque frappe). */
export function useModifierLigneDocument(): UseMutationResult<
  ReponseDocumentVente,
  unknown,
  VariablesModificationLigne
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentId, ligneId, entree }: VariablesModificationLigne) =>
      modifierLigneDocument(documentId, ligneId, entree),
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
 *  `documents-vente.api.ts`). Câblé depuis l'issue #125 (`EcranFicheFacture.tsx`). */
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
