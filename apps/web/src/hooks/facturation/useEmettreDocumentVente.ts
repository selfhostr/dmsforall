import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeEmissionDocumentVente,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { clesFacturation } from './cles';
import { emettreDocumentVente } from './documents-vente.api';

interface VariablesEmission {
  readonly id: string;
  readonly entree: EntreeEmissionDocumentVente;
  /** Générée par l'appelant à l'OUVERTURE du dialogue de confirmation, pas au clic sur « Émettre »
   *  (`design-etape-2-facturation.md` §4.5/§6.2, `RF-25`) — via `useCleIdempotence()`
   *  (`@/api/idempotence.ts`), régénérée avant tout rejeu qui ajoute `confirmations[]`. */
  readonly idempotencyKey: string;
}

/**
 * `POST /documents-vente/{id}/emettre` — couche mutation pure, sert aussi bien l'émission d'une
 * facture (écran 2, §4.5) que celle d'un avoir (écran 4, §6.2) : même endpoint, même corps. Pose le
 * document ÉMIS directement dans son propre cache (l'écran ne relit jamais après succès, même
 * principe que les transitions d'OR) et invalide la liste par préfixe.
 */
export function useEmettreDocumentVente(): UseMutationResult<
  ReponseAvecAvertissements<ReponseDocumentVente>,
  unknown,
  VariablesEmission
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, entree, idempotencyKey }: VariablesEmission) =>
      emettreDocumentVente(id, entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(
        clesFacturation.documents.detail(reponse.donnees.id),
        reponse.donnees,
      );
      void queryClient.invalidateQueries({ queryKey: ['facturation', 'documents', 'liste'] });
      // Un avoir émis modifie le solde (jamais le `statut`) de la facture qu'il crédite : la fiche
      // de la facture d'origine doit se rafraîchir si elle est déjà en cache (§6.2).
      if (reponse.donnees.factureAnnuleeId) {
        void queryClient.invalidateQueries({
          queryKey: clesFacturation.documents.detail(reponse.donnees.factureAnnuleeId),
        });
      }
    },
  });
}
