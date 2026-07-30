import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCorrectionFacture, ReponseAvecAvertissements, ReponseCorrectionFacture } from '@dfa/shared';

import { clesFacturation } from './cles';
import { corrigerFacture } from './documents-vente.api';

interface VariablesCorrection {
  readonly factureId: string;
  readonly entree: EntreeCorrectionFacture;
  readonly idempotencyKey: string;
}

/**
 * `POST /documents-vente/{factureId}/corriger` — le geste unique de l'écran 2 §4.7 : une
 * transaction, deux documents nés (avoir total + facture de remplacement, déjà `emis`, `RF-13`).
 * Pose les DEUX dans le cache et invalide la facture d'origine (devenue `annule_par_avoir`) ainsi
 * que la liste.
 */
export function useCorrigerFacture(): UseMutationResult<
  ReponseAvecAvertissements<ReponseCorrectionFacture>,
  unknown,
  VariablesCorrection
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ factureId, entree, idempotencyKey }: VariablesCorrection) => corrigerFacture(factureId, entree, idempotencyKey),
    onSuccess: (reponse, variables) => {
      queryClient.setQueryData(clesFacturation.documents.detail(reponse.donnees.avoir.id), reponse.donnees.avoir);
      queryClient.setQueryData(
        clesFacturation.documents.detail(reponse.donnees.factureRemplacement.id),
        reponse.donnees.factureRemplacement,
      );
      void queryClient.invalidateQueries({ queryKey: clesFacturation.documents.detail(variables.factureId) });
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
    },
  });
}
