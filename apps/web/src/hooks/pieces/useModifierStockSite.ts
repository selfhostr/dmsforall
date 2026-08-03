import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type { EntreeModificationStockSite, ReponseStockArticle } from '@dfa/shared';

import { clesPieces } from './cles';
import { modifierStockSite } from './stock.api';

interface VariablesModificationStockSite {
  readonly articleId: string;
  readonly siteId: string;
  readonly entree: EntreeModificationStockSite;
}

/**
 * `PATCH /articles/{id}/stock/{siteId}` — réglages de site (emplacement, seuils). Invalide la
 * fiche article (son `stocksResume` embarque emplacement/quantités) et le réapprovisionnement
 * (dépend de `stockMinimumMillieme`) — jamais la quantité physique, qui ne bouge que par
 * mouvement (voir `useCreerMouvementStock`).
 *
 * PAS ENCORE CONSOMMÉ PAR UN ÉCRAN (à ce lot) : `ReponseArticle.stocksResume` (fiche article)
 * n'expose pas l'emplacement/les seuils actuels d'un site — seulement les quantités — donc un
 * formulaire d'édition ici partirait vide plutôt que pré-rempli, une régression UX plus qu'un
 * gain. La couche transport/mutation est posée et testée-typée pour qu'un écran dédié (avec sa
 * propre lecture des réglages, absente des 18 routes de ce lot) puisse la consommer directement.
 */
export function useModifierStockSite(): UseMutationResult<ReponseStockArticle, unknown, VariablesModificationStockSite> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ articleId, siteId, entree }: VariablesModificationStockSite) => modifierStockSite(articleId, siteId, entree),
    onSuccess: (_donnees, variables) => {
      void queryClient.invalidateQueries({ queryKey: clesPieces.articles.detail(variables.articleId) });
      void queryClient.invalidateQueries({ queryKey: ['pieces', 'stock', 'reapprovisionnement'] });
    },
  });
}
