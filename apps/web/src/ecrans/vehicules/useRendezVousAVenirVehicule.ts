import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseRendezVous } from '@dfa/shared';

import { useDoitReessayer } from '@/hooks/pagination-curseur';

import { listerRendezVousAVenirVehicule } from './rendez-vous-vehicule.api';

/** Clé de cache locale — `clesQuery` (`api/cles.ts`) est hors périmètre d'écriture ici, même
 *  doctrine que `['vehicule-ordres-reparation', vehiculeId]` déjà présent dans
 *  `EcranFicheVehicule.tsx`. Exportée pour invalider ce cache après création. */
export function clesRendezVousAVenirVehicule(vehiculeId: string): readonly unknown[] {
  return ['vehicules', vehiculeId, 'rendez-vous-a-venir'];
}

export interface OptionsRendezVousAVenirVehicule {
  /** Défaut `true`. À poser à `false` quand l'appelant sait DÉJÀ (matrice de droits côté front,
   *  `ecrans/vehicules/droits.ts::peutLireRendezVous`) que le rôle courant n'a pas
   *  `rendez_vous.lire` — évite d'émettre une requête vouée à un 403 stable (défaut mesuré, issue
   *  #162 : le bloc « Prochains rendez-vous » d'un vendeur restait en squelette de chargement
   *  indéfiniment, TanStack Query réessayant par défaut un refus qui ne se résoudra jamais). */
  readonly enabled?: boolean;
}

/**
 * Rendez-vous à venir de CE véhicule, filtre `vehiculeId` appliqué côté serveur (voir
 * `rendez-vous-vehicule.api.ts`) — n'a plus besoin du détenteur courant (issue #97) : un véhicule
 * sans détenteur affiche désormais ses rendez-vous comme n'importe quel autre.
 *
 * Politique de réessai : `useDoitReessayer()` (`@/hooks/pagination-curseur`), même doctrine que
 * `useListeDossiersVente` — un `403 DROIT_INSUFFISANT`/`404 RESSOURCE_INTROUVABLE` est un état
 * STABLE (aucun réessai ne le résoudra jamais), en filet même si le calcul front (`enabled`
 * ci-dessus) divergeait du serveur.
 */
export function useRendezVousAVenirVehicule(
  vehiculeId: string | undefined,
  options: OptionsRendezVousAVenirVehicule = {},
): UseQueryResult<readonly ReponseRendezVous[]> {
  const reessayer = useDoitReessayer();
  return useQuery({
    queryKey: clesRendezVousAVenirVehicule(vehiculeId ?? ''),
    queryFn: () => listerRendezVousAVenirVehicule(vehiculeId as string),
    enabled: vehiculeId !== undefined && (options.enabled ?? true),
    retry: reessayer,
  });
}
