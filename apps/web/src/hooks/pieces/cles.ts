import type { FiltresMouvementsStock, FiltresReapprovisionnement, FiltresReservations } from '@dfa/shared';

import type { FiltresListeArticles } from './articles.api';

/**
 * Clés TanStack Query du domaine pièces — même convention que `clesFacturation`
 * (`hooks/facturation/cles.ts`) et `clesParametrage` (`hooks/parametrage/cles.ts`) : tuple plat,
 * tenue ICI plutôt que fusionnée dans `api/cles.ts` (gelé depuis l'étape 1, hors périmètre de cet
 * agent — voir l'en-tête de `hooks/facturation/cles.ts` pour l'historique de cette décision).
 *
 * Chaque clé de liste porte l'objet de filtres COMPLET envoyé au serveur (même choix que
 * `clesFacturation.documents.liste`) — pas une forme réduite aux seules valeurs primitives : les
 * filtres de mouvements/réservations portent des tableaux (`type`, `statut`), qu'une forme
 * `Record<string, primitif>` ne peut pas représenter.
 */
export const clesPieces = {
  articles: {
    liste: (filtres: FiltresListeArticles) => ['pieces', 'articles', 'liste', filtres] as const,
    detail: (id: string) => ['pieces', 'articles', 'detail', id] as const,
    rechercheComptoir: (q: string, siteId: string) => ['pieces', 'articles', 'rechercheComptoir', q, siteId] as const,
    disponibilite: (articleId: string, siteId: string) => ['pieces', 'articles', 'disponibilite', articleId, siteId] as const,
    mouvements: (articleId: string, filtres: FiltresMouvementsStock) =>
      ['pieces', 'articles', 'mouvements', articleId, filtres] as const,
  },

  stock: {
    reapprovisionnement: (filtres: FiltresReapprovisionnement) => ['pieces', 'stock', 'reapprovisionnement', filtres] as const,
  },

  reservations: {
    liste: (filtres: FiltresReservations) => ['pieces', 'reservations', 'liste', filtres] as const,
  },
} as const;
