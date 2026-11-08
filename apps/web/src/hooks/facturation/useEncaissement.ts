import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeCreationPaiement, ReponsePaiement } from '@dfa/shared';

import { clesFacturation } from './cles';
import { creerPaiement } from './paiements.api';

interface VariablesEncaissement {
  readonly entree: EntreeCreationPaiement;
  readonly idempotencyKey: string;
}

/** `POST /paiements` — écran 3 (encaissement). Invalide chaque document imputé (son
 *  `statutReglement`/`soldeCentimes` change) et la liste des factures ; invalide aussi les
 *  « factures ouvertes » de chaque payeur concerné (elles peuvent quitter cette liste). */
export function useEncaissement(
  options: { readonly silencieux?: boolean } = {},
): UseMutationResult<ReponsePaiement, unknown, VariablesEncaissement> {
  const queryClient = useQueryClient();

  return useMutation({
    meta: options.silencieux ? undefined : { succes: 'commun:toasts.paiementEnregistre' },
    mutationFn: ({ entree, idempotencyKey }: VariablesEncaissement) =>
      creerPaiement(entree, idempotencyKey),
    onSuccess: (paiement, variables) => {
      for (const imputation of paiement.imputations) {
        void queryClient.invalidateQueries({
          queryKey: clesFacturation.documents.detail(imputation.documentId),
        });
        void queryClient.invalidateQueries({
          queryKey: clesFacturation.documents.paiements(imputation.documentId),
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
      if (variables.entree.payeurClientId) {
        void queryClient.invalidateQueries({
          queryKey: clesFacturation.documents.ouvertesClient(variables.entree.payeurClientId),
        });
      }
    },
  });
}
