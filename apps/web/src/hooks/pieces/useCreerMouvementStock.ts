import {
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';

import type {
  EntreeCreationAjustementInventaire,
  EntreeCreationMouvementCasse,
  EntreeCreationMouvementPerte,
  EntreeCreationMouvementTransfert,
  EntreeCreationRetourFournisseur,
  ReponseAvecAvertissements,
  ReponseMouvementStock,
} from '@dfa/shared';

import { clesPieces } from './cles';
import {
  creerAjustementInventaire,
  creerMouvementCasse,
  creerMouvementPerte,
  creerMouvementTransfert,
  creerRetourFournisseur,
} from './mouvements.api';

/**
 * Les CINQ mouvements à déclenchement direct (RP-16 → RP-18, `casse`/`perte`/`transfert`/
 * `ajustement-inventaire`/`retour-fournisseur`) — `mouvement_stock` est IMMUABLE côté serveur,
 * donc jamais de `setQueryData` optimiste ici : chaque succès INVALIDE la fiche article (son
 * `stocksResume` a changé), l'historique des mouvements et le réapprovisionnement, plutôt que de
 * deviner la nouvelle quantité côté client.
 */
function invaliderApresMouvement(queryClient: QueryClient, articleId: string): void {
  void queryClient.invalidateQueries({ queryKey: clesPieces.articles.detail(articleId) });
  void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'mouvements', articleId] });
  void queryClient.invalidateQueries({ queryKey: ['pieces', 'stock', 'reapprovisionnement'] });
}

interface VariablesMouvement<TEntree> {
  readonly entree: TEntree;
  /** Une clé par SOUMISSION de dialogue — même règle que `useCleIdempotence` (§5 étape 1) : un
   *  rejeu (double-clic, retry réseau) ne doit jamais créer deux mouvements. */
  readonly idempotencyKey: string;
}

/** `POST /articles/{id}/mouvements/casse`. */
export function useCreerMouvementCasse(
  articleId: string,
): UseMutationResult<
  ReponseMouvementStock,
  unknown,
  VariablesMouvement<EntreeCreationMouvementCasse>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) =>
      creerMouvementCasse(articleId, entree, idempotencyKey),
    onSuccess: () => invaliderApresMouvement(queryClient, articleId),
  });
}

/** `POST /articles/{id}/mouvements/perte`. */
export function useCreerMouvementPerte(
  articleId: string,
): UseMutationResult<
  ReponseMouvementStock,
  unknown,
  VariablesMouvement<EntreeCreationMouvementPerte>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) =>
      creerMouvementPerte(articleId, entree, idempotencyKey),
    onSuccess: () => invaliderApresMouvement(queryClient, articleId),
  });
}

/** `POST /articles/{id}/mouvements/transfert` — un mouvement unique entre deux sites (RP-13). */
export function useCreerMouvementTransfert(
  articleId: string,
): UseMutationResult<
  ReponseMouvementStock,
  unknown,
  VariablesMouvement<EntreeCreationMouvementTransfert>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) =>
      creerMouvementTransfert(articleId, entree, idempotencyKey),
    onSuccess: () => invaliderApresMouvement(queryClient, articleId),
  });
}

/** `POST /articles/{id}/mouvements/ajustement-inventaire` — quantité COMPTÉE, jamais un delta
 *  (§7.6). `donnees: null` si le compte correspond déjà au stock physique (aucun mouvement créé,
 *  mais la fiche reste invalidée par prudence : le serveur seul sait). */
export function useCreerAjustementInventaire(
  articleId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseMouvementStock | null>,
  unknown,
  VariablesMouvement<EntreeCreationAjustementInventaire>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) =>
      creerAjustementInventaire(articleId, entree, idempotencyKey),
    onSuccess: () => invaliderApresMouvement(queryClient, articleId),
  });
}

/** `POST /articles/{id}/mouvements/retour-fournisseur` (RP-30). */
export function useCreerRetourFournisseur(
  articleId: string,
): UseMutationResult<
  ReponseMouvementStock,
  unknown,
  VariablesMouvement<EntreeCreationRetourFournisseur>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) =>
      creerRetourFournisseur(articleId, entree, idempotencyKey),
    onSuccess: () => invaliderApresMouvement(queryClient, articleId),
  });
}
