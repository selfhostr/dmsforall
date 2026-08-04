import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { VehiculeStockResume } from '@dfa/shared';

import { clesVentesDossiers } from './cles';
import {
  rechercherVehiculesStockSelection,
  type FiltresVehiculesStockSelection,
} from './vehicules-stock-selection.api';

/** Véhicules `disponible`/`en_commande` — les deux statuts qu'un dossier peut valablement associer
 *  (`engager` refuse `409 VENTE_VEHICULE_INDISPONIBLE` sinon, RV-32). `enabled: false` tant que la
 *  recherche est vide : pas d'appel à vide au premier rendu du sélecteur (même garde que
 *  `useRechercheComptoirPieces`). */
export function useVehiculesStockDisponibles(
  q: string,
): UseQueryResult<readonly VehiculeStockResume[]> {
  const filtres: FiltresVehiculesStockSelection = {
    q: q.trim() === '' ? undefined : q.trim(),
    statutCommercial: ['disponible', 'en_commande'],
  };

  return useQuery({
    queryKey: clesVentesDossiers.vehiculesStockSelection(filtres),
    queryFn: () => rechercherVehiculesStockSelection(filtres),
    enabled: q.trim() !== '',
  });
}
