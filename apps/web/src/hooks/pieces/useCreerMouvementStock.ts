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
  EntreeCreationMouvementRetourClient,
  EntreeCreationMouvementSortieComptoir,
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
  creerMouvementRetourClient,
  creerMouvementSortieComptoir,
  creerMouvementTransfert,
  creerRetourFournisseur,
} from './mouvements.api';

/**
 * Les mouvements à déclenchement direct (RP-16 → RP-18, `casse`/`perte`/`transfert`/
 * `ajustement-inventaire`/`retour-fournisseur`/`sortie-comptoir`/`retour-client`) —
 * `mouvement_stock` est IMMUABLE côté serveur, donc jamais de `setQueryData` optimiste ici :
 * chaque succès INVALIDE la fiche article (son `stocksResume` a changé), l'historique des
 * mouvements, le réapprovisionnement, ET la recherche comptoir (préfixe de clé, tous les `q`/
 * `siteId` en cache confondus — `sortie-comptoir`/`retour-client` se déclenchent PRÉCISÉMENT
 * depuis cet écran, la quantité disponible affichée doit se rafraîchir sans action manuelle),
 * plutôt que de deviner la nouvelle quantité côté client.
 */
function invaliderApresMouvement(queryClient: QueryClient, articleId: string): void {
  void queryClient.invalidateQueries({ queryKey: clesPieces.articles.detail(articleId) });
  void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'mouvements', articleId] });
  void queryClient.invalidateQueries({ queryKey: ['pieces', 'stock', 'reapprovisionnement'] });
  void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'rechercheComptoir'] });
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

/**
 * `POST /articles/{id}/mouvements/sortie-comptoir` — vente DIRECTE au comptoir, sans document de
 * vente (voir la note d'intégration en fin de `contrats/pieces/mouvement.ts`). Mutation BRUTE :
 * la gestion de la clé d'idempotence par INTENTION (un `useRef` régénéré au succès seulement) vit
 * dans `useVenteComptoir` (`useVenteComptoirPieces.ts`), ce hook-ci ne fait que porter la clé
 * reçue jusqu'au transport — même séparation que les cinq mouvements ci-dessus.
 */
export function useCreerMouvementSortieComptoir(
  articleId: string,
): UseMutationResult<
  ReponseMouvementStock,
  unknown,
  VariablesMouvement<EntreeCreationMouvementSortieComptoir>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) =>
      creerMouvementSortieComptoir(articleId, entree, idempotencyKey),
    onSuccess: () => invaliderApresMouvement(queryClient, articleId),
    // Un `409 STOCK_INSUFFISANT` signale presque toujours qu'un AUTRE geste a consommé le stock
    // entre la recherche et cette tentative (concurrence normale au comptoir) — la quantité
    // affichée doit se corriger MÊME sur un refus, pas seulement sur un succès, pour que le
    // prochain essai voie le bon chiffre sans recharger la page.
    onError: () => invaliderApresMouvement(queryClient, articleId),
  });
}

/**
 * `POST /articles/{id}/mouvements/retour-client` — le client rapporte une pièce. Jamais refusé
 * pour stock insuffisant (une entrée ne l'est jamais) : `onError` n'a donc pas besoin d'invalider
 * par anticipation d'un chiffre périmé, à la différence de la sortie comptoir ci-dessus.
 */
export function useCreerMouvementRetourClient(
  articleId: string,
): UseMutationResult<
  ReponseMouvementStock,
  unknown,
  VariablesMouvement<EntreeCreationMouvementRetourClient>
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }) =>
      creerMouvementRetourClient(articleId, entree, idempotencyKey),
    onSuccess: () => invaliderApresMouvement(queryClient, articleId),
  });
}
