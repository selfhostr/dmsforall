import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseDocumentVente } from '@dfa/shared';

import { clesFacturation } from './cles';
import { accepterDevis, annulerAccordDevis } from './documents-vente.api';

/**
 * « Accord du client » sur un devis envoyé : `POST /documents-vente/{id}/accepter`. Pose le devis
 * accepté dans son propre cache (l'écran ne relit pas) et invalide les listes par préfixe.
 */
export function useAccepterDevis(): UseMutationResult<ReponseDocumentVente, unknown, string> {
  const queryClient = useQueryClient();
  return useMutation({
    meta: {
      succes: 'facturation:toasts.devisAccepte',
      // « Annuler » du toast : retablit le devis `emis` (erreur de clic).
      annuler: async (document_: ReponseDocumentVente) => {
        const retabli = await annulerAccordDevis(document_.id);
        queryClient.setQueryData(clesFacturation.documents.detail(retabli.id), retabli);
        void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
      },
    },
    mutationFn: (id: string) => accepterDevis(id),
    onSuccess: (document_) => {
      queryClient.setQueryData(clesFacturation.documents.detail(document_.id), document_);
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
    },
  });
}
