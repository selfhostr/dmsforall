import { useQueries } from '@tanstack/react-query';

import type { ReponseDepotPneus } from '@dfa/shared';

import {
  listerDepotsPneusVehicule,
  type FiltresDepotsVehicule,
} from '@/hooks/pneus/depot-pneus.api';
import { clesPneus } from '@/hooks/pneus/cles';

const FILTRES: FiltresDepotsVehicule = { statut: ['en_depot', 'a_relancer'], tri: 'entreLe:desc' };

export type EtatDepotPneusClient =
  | { readonly etat: 'inconnu' }
  | { readonly etat: 'chargement' }
  | { readonly etat: 'erreur' }
  | { readonly etat: 'present'; readonly depots: readonly ReponseDepotPneus[] }
  | { readonly etat: 'absent' };

/**
 * Les pneus du client sont-ils déjà au dépôt ? Interroge les dépôts physiquement présents
 * (`en_depot` + `a_relancer`) des véhicules du client — une requête par véhicule (un client en a
 * 1 à 3), même clé de cache que la fiche véhicule. `inconnu` tant qu'aucun véhicule n'est connu ;
 * `erreur` distinct de `absent` (absence de donnée != « aucun pneu »).
 */
export function useDepotsPneusClient(
  vehiculeIds: readonly string[],
  actif: boolean,
): EtatDepotPneusClient {
  const resultats = useQueries({
    queries: vehiculeIds.map((id) => ({
      queryKey: clesPneus.vehicule.depots(id, FILTRES),
      queryFn: () => listerDepotsPneusVehicule(id, FILTRES, { limite: 20 }),
      enabled: actif,
    })),
  });

  if (!actif || vehiculeIds.length === 0) return { etat: 'inconnu' };
  if (resultats.some((r) => r.isPending)) return { etat: 'chargement' };
  if (resultats.some((r) => r.isError)) return { etat: 'erreur' };
  const depots = resultats.flatMap((r) => r.data?.donnees ?? []);
  return depots.length > 0 ? { etat: 'present', depots } : { etat: 'absent' };
}
