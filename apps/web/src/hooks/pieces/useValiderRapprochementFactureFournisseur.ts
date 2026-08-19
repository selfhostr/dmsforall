import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseFactureFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { validerRapprochementFactureFournisseur } from './factures-fournisseur.temporaire';

/** `POST /factures-fournisseur/{id}/valider` (contrat temporaire) — confirmation EXPLICITE du
 *  magasinier, écarts ou non (« aucune validation automatique », brief). Même patron que
 *  `useEnvoyerCommandeFournisseur` : pose la fiche complète en cache, invalide la liste. */
export function useValiderRapprochementFactureFournisseur(
  id: string,
): UseMutationResult<ReponseFactureFournisseur, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => validerRapprochementFactureFournisseur(id),
    onSuccess: (facture) => {
      queryClient.setQueryData(clesPieces.facturesFournisseur.detail(id), facture);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'facturesFournisseur', 'liste'] });
    },
  });
}
