import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseDocumentVente } from '@dfa/shared';

import { clesFacturation } from './cles';
import { annulerAccordDevis } from './documents-vente.api';

/**
 * Annule l'accord du client sur un devis : `POST /documents-vente/{id}/annuler-accord`
 * (`accepte` -> `emis`). Même cache que `useAccepterDevis`.
 */
export function useAnnulerAccordDevis(): UseMutationResult<ReponseDocumentVente, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { succes: 'facturation:toasts.accordAnnule' },
    mutationFn: (id: string) => annulerAccordDevis(id),
    onSuccess: (document_) => {
      queryClient.setQueryData(clesFacturation.documents.detail(document_.id), document_);
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
    },
  });
}
