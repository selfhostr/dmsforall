import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeRejetFactureFournisseur, ReponseFactureFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { rejeterFactureFournisseur } from './factures-fournisseur.temporaire';

/** `POST /factures-fournisseur/{id}/rejeter` — motif obligatoire (`EntreeRejetFactureFournisseur`,
 *  `schemaMotif`, ≥ 3 caractères, `@dfa/shared`). TERMINAL (`statut: 'rejetee'`) : le document
 *  reste conservé et consultable (art. 958f CO), seule la décision se corrige par un nouveau dépôt
 *  humain hors de ce contrat — jamais de `DELETE`. Même patron que
 *  `useAnnulerCommandeFournisseur` : pose la fiche complète en cache, invalide la liste. */
export function useRejeterFactureFournisseur(
  id: string,
): UseMutationResult<ReponseFactureFournisseur, unknown, EntreeRejetFactureFournisseur> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: EntreeRejetFactureFournisseur) => rejeterFactureFournisseur(id, entree),
    onSuccess: (facture) => {
      queryClient.setQueryData(clesPieces.facturesFournisseur.detail(id), facture);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'facturesFournisseur', 'liste'] });
    },
  });
}
