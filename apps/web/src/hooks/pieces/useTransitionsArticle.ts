import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeCreationReferenceArticle,
  EntreeDesactivationArticle,
  EntreeMarquageObsolete,
  EntreeModificationArticle,
  ReponseArticle,
  ReponseAvecAvertissements,
} from '@dfa/shared';

import { clesPieces } from './cles';
import {
  ajouterReferenceArticle,
  desactiverArticle,
  marquerObsoleteArticle,
  modifierArticle,
  reactiverArticle,
} from './articles.api';

/**
 * Une mutation par action nommée sur un article — même patron que `useActionOrdreReparation`
 * (`hooks/atelier/useTransitionsOrdreReparation.ts`) : chaque action renvoie l'article COMPLET,
 * posé directement dans le cache via `setQueryData` (jamais de relecture), et invalide la liste
 * par PRÉFIXE pour couvrir toute variante de filtre/tri déjà en cache.
 */
function useActionArticle<TEntree>(
  articleId: string,
  action: (
    articleId: string,
    entree: TEntree,
  ) => Promise<ReponseAvecAvertissements<ReponseArticle>>,
): UseMutationResult<ReponseAvecAvertissements<ReponseArticle>, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(articleId, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.articles.detail(articleId), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'liste'] });
    },
  });
}

/** `PATCH /articles/{id}`. */
export function useModifierArticle(articleId: string) {
  return useActionArticle<EntreeModificationArticle>(articleId, modifierArticle);
}

/** `POST /articles/{id}/references` — upsert (RP-02/RP-03). PAS ENCORE CONSOMMÉ PAR UN ÉCRAN (à ce
 *  lot) : la fiche article n'affiche les références qu'en LECTURE (déjà embarquées sur
 *  `ReponseArticle.references`) ; ce lot priorise recherche comptoir + fiche/liste + réservations
 *  + réapprovisionnement (brief). Couche prête pour le dialogue d'ajout d'un futur lot. */
export function useAjouterReferenceArticle(articleId: string) {
  return useActionArticle<EntreeCreationReferenceArticle>(articleId, ajouterReferenceArticle);
}

/** `POST /articles/{id}/marquer-obsolete` (RP-04). */
export function useMarquerObsoleteArticle(articleId: string) {
  return useActionArticle<EntreeMarquageObsolete>(articleId, marquerObsoleteArticle);
}

/** `POST /articles/{id}/desactiver` (§6.1). */
export function useDesactiverArticle(articleId: string) {
  return useActionArticle<EntreeDesactivationArticle>(articleId, desactiverArticle);
}

/** `POST /articles/{id}/reactiver` — aucun corps (§6.1). */
export function useReactiverArticle(
  articleId: string,
): UseMutationResult<ReponseAvecAvertissements<ReponseArticle>, unknown, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => reactiverArticle(articleId),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesPieces.articles.detail(articleId), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'articles', 'liste'] });
    },
  });
}
