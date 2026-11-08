import { useQueries } from '@tanstack/react-query';

import { recupererArticle } from './articles.api';
import { clesPieces } from './cles';

/** Désignation lisible d'un article, ou `undefined` tant qu'elle n'est pas connue (chargement,
 *  refus de lecture) — l'appelant retombe alors sur un libellé de repli, jamais sur un blanc. */
export type DesignationsArticles = ReadonlyMap<string, string>;

/**
 * Résout les désignations d'une liste d'articles (`GET /articles/{id}`, même clé de cache que
 * `useArticle`). Les lignes de commande fournisseur ne portent que `articleId` : sans ceci l'écran
 * affichait « Article 1 », « Article 2 » (issue #64).
 */
export function useDesignationsArticles(articleIds: readonly string[]): DesignationsArticles {
  const uniques = [...new Set(articleIds)];
  const resultats = useQueries({
    queries: uniques.map((id) => ({
      queryKey: clesPieces.articles.detail(id),
      queryFn: () => recupererArticle(id),
    })),
  });
  const designations = new Map<string, string>();
  resultats.forEach((resultat, index) => {
    const id = uniques[index];
    if (id !== undefined && resultat.data) designations.set(id, resultat.data.designation);
  });
  return designations;
}
