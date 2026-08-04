import type { FiltresListeVehiculesStock } from './vehicule-stock.api';

/**
 * Clés TanStack Query du sous-module véhicules en stock (VN/VO, étape 4) — même convention que
 * `clesPieces` (`hooks/pieces/cles.ts`) : tuple plat, tenu ICI plutôt que dans `api/cles.ts`
 * (gelé depuis l'étape 1, hors périmètre de cet agent — même raison que documentée en tête de
 * `hooks/facturation/cles.ts` et `hooks/pieces/cles.ts`).
 *
 * La clé de liste porte l'objet de filtres COMPLET envoyé au serveur (même choix que
 * `clesPieces.articles.liste`) — `provenance`/`statutCommercial` sont des tableaux, qu'une forme
 * `Record<string, primitif>` ne peut pas représenter.
 */
export const clesVentesStock = {
  liste: (filtres: FiltresListeVehiculesStock) => ['ventes', 'stock', 'liste', filtres] as const,
  /** `id` ici est `vehicule.id` (décision structurante du contrat, voir vehicule-stock.api.ts). */
  detail: (id: string) => ['ventes', 'stock', 'detail', id] as const,
} as const;
