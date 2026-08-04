import type { FiltresDossiersVente } from '@dfa/shared';

import type { FiltresVehiculesStockSelection } from './vehicules-stock-selection.api';

/**
 * Clés TanStack Query du sous-domaine « dossiers de vente » — même convention que `clesPieces`
 * (`hooks/pieces/cles.ts`) : tuple plat, tenu ICI plutôt que fusionné dans `api/cles.ts` (gelé
 * depuis l'étape 1, hors périmètre de cet agent).
 *
 * Chaque clé de liste porte l'objet de filtres COMPLET envoyé au serveur (même choix que
 * `clesPieces.articles.liste`), pas une forme réduite — `statut` est un tableau, une forme
 * `Record<string, primitif>` ne peut pas le représenter fidèlement.
 */
export const clesVentesDossiers = {
  liste: (filtres: FiltresDossiersVente) => ['ventes', 'dossiers', 'liste', filtres] as const,
  detail: (id: string) => ['ventes', 'dossiers', 'detail', id] as const,
  vehiculesStockSelection: (filtres: FiltresVehiculesStockSelection) =>
    ['ventes', 'dossiers', 'vehiculesStockSelection', filtres] as const,
} as const;
