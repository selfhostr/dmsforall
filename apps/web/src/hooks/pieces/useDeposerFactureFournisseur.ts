import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseFactureFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { deposerFactureFournisseur } from './factures-fournisseur.temporaire';

export interface VariablesDepotFactureFournisseur {
  readonly fichier: File;
  /** Porté par l'écran (`AbortController` propre à CE dépôt) — permet l'annulation explicite
   *  pendant la lecture (brief : « la possibilité d'annuler »). L'écran appelant DOIT vérifier
   *  `signal.aborted` avant de traiter un rejet comme une vraie erreur (même patron que
   *  `EcranScan.tsx#envoyerPourAnalyse`) : une annulation volontaire n'est jamais un échec. */
  readonly signal: AbortSignal;
}

/** `POST /factures-fournisseur` (contrat temporaire — voir la doc de tête de
 *  `factures-fournisseur.temporaire.ts`). Aucune `Idempotency-Key` : la déduplication d'un dépôt
 *  répété se fait CÔTÉ SERVEUR par empreinte SHA-256 du fichier (`ServiceFactureFournisseur.
 *  deposer`, 409 CONFLIT sur un fichier déjà déposé) — le service ne lit de toute façon aucune clé
 *  d'idempotence pour cette route. Pose directement la fiche complète dans le cache (`detail`) et
 *  invalide la liste par préfixe, même patron que `useTransitionsCommandeFournisseur`. */
export function useDeposerFactureFournisseur(): UseMutationResult<
  ReponseFactureFournisseur,
  unknown,
  VariablesDepotFactureFournisseur
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ fichier, signal }: VariablesDepotFactureFournisseur) =>
      deposerFactureFournisseur(fichier, signal),
    onSuccess: (facture) => {
      queryClient.setQueryData(clesPieces.facturesFournisseur.detail(facture.id), facture);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'facturesFournisseur', 'liste'] });
    },
  });
}
