import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeAnnulationCommandeFournisseur,
  EntreeAnnulationReliquat,
  EntreeReceptionCommandeFournisseur,
  ReponseAvecAvertissements,
  ReponseCommandeFournisseur,
  ReponseReceptionCommandeFournisseur,
} from '@dfa/shared';

import { clesPieces } from './cles';
import {
  annulerCommandeFournisseur,
  annulerReliquatLigneCommande,
  envoyerCommandeFournisseur,
  receptionnerCommandeFournisseur,
} from './commandes-fournisseur.api';

/**
 * Une mutation par action nommée sur une commande fournisseur — même patron que
 * `useTransitionsArticle` : chaque action renvoie la commande COMPLÈTE, posée directement dans le
 * cache via `setQueryData` (jamais de relecture), et invalide la liste par PRÉFIXE.
 */
function useActionCommandeFournisseur<TEntree>(
  id: string,
  action: (id: string, entree: TEntree) => Promise<ReponseAvecAvertissements<ReponseCommandeFournisseur>>,
): UseMutationResult<ReponseAvecAvertissements<ReponseCommandeFournisseur>, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(id, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.commandesFournisseur.detail(id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'commandesFournisseur', 'liste'] });
    },
  });
}

/** `POST /commandes-fournisseur/{id}/envoyer` — aucun corps (§6.2). */
export function useEnvoyerCommandeFournisseur(id: string): UseMutationResult<ReponseAvecAvertissements<ReponseCommandeFournisseur>, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => envoyerCommandeFournisseur(id),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.commandesFournisseur.detail(id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'commandesFournisseur', 'liste'] });
    },
  });
}

/** `POST /commandes-fournisseur/{id}/annuler` — motif obligatoire, uniquement avant réception. */
export function useAnnulerCommandeFournisseur(id: string) {
  return useActionCommandeFournisseur<EntreeAnnulationCommandeFournisseur>(id, annulerCommandeFournisseur);
}

interface VariablesAnnulationReliquat {
  readonly ligneId: string;
  readonly entree: EntreeAnnulationReliquat;
}

/** `POST /commandes-fournisseur/{id}/lignes/{ligneId}/annuler-reliquat` — solde un reliquat SANS
 *  livraison (RP-28), motif obligatoire. */
export function useAnnulerReliquatLigneCommande(
  id: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseCommandeFournisseur>, unknown, VariablesAnnulationReliquat> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ligneId, entree }: VariablesAnnulationReliquat) => annulerReliquatLigneCommande(id, ligneId, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.commandesFournisseur.detail(id), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'commandesFournisseur', 'liste'] });
    },
  });
}

interface VariablesReceptionCommandeFournisseur {
  readonly entree: EntreeReceptionCommandeFournisseur;
  readonly idempotencyKey: string;
}

/** `POST /commandes-fournisseur/{id}/reception` — génère un ou plusieurs mouvements
 *  `entree_livraison` (§7.4) : invalide largement le référentiel article (stock, mouvements,
 *  disponibilité, réapprovisionnement) en plus de la commande elle-même — même doctrine que
 *  `useSatisfaireReservation` (l'écran de réception ne connaît pas forcément tous les
 *  `articleId` impactés à l'avance). */
export function useReceptionnerCommandeFournisseur(
  id: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseReceptionCommandeFournisseur>, unknown, VariablesReceptionCommandeFournisseur> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesReceptionCommandeFournisseur) => receptionnerCommandeFournisseur(id, entree, idempotencyKey),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.commandesFournisseur.detail(id), reponse.donnees.commandeFournisseur);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'commandesFournisseur', 'liste'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'detail'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'mouvements'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'disponibilite'] });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'stock', 'reapprovisionnement'] });
    },
  });
}
