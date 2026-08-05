import type { FiltresARelancer, FiltresDepotsVehicule, FiltresHangar } from './depot-pneus.api';

/**
 * Clés TanStack Query du domaine pneus — même convention que `clesPieces` (`hooks/pieces/cles.ts`) :
 * tuple plat, tenue ICI plutôt que dans `api/cles.ts` (gelé depuis l'étape 1, hors périmètre de
 * cet agent). Chaque clé de liste porte l'objet de filtres COMPLET envoyé au serveur.
 */
export const clesPneus = {
  hangar: {
    liste: (siteId: string, filtres: FiltresHangar) =>
      ['pneus', 'hangar', siteId, filtres] as const,
  },
  vehicule: {
    depots: (vehiculeId: string, filtres: FiltresDepotsVehicule) =>
      ['pneus', 'vehicule', 'depots', vehiculeId, filtres] as const,
  },
  aRelancer: {
    liste: (filtres: FiltresARelancer) => ['pneus', 'aRelancer', 'liste', filtres] as const,
  },
} as const;
