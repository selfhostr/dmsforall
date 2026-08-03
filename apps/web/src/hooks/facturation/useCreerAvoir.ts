import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationAvoir,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { clesFacturation } from './cles';
import { creerAvoir } from './documents-vente.api';

interface VariablesCreationAvoir {
  readonly factureId: string;
  readonly entree: EntreeCreationAvoir;
  readonly idempotencyKey: string;
}

/** `POST /documents-vente/{factureId}/avoirs` — écran 4 (§6) : crée le BROUILLON d'avoir, émis
 *  séparément ensuite via `useEmettreDocumentVente` (même geste en deux temps que la facture,
 *  cohérent avec `RF-9`). */
export function useCreerAvoir(): UseMutationResult<
  ReponseAvecAvertissements<ReponseDocumentVente>,
  unknown,
  VariablesCreationAvoir
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ factureId, entree, idempotencyKey }: VariablesCreationAvoir) =>
      creerAvoir(factureId, entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(
        clesFacturation.documents.detail(reponse.donnees.id),
        reponse.donnees,
      );
    },
  });
}
