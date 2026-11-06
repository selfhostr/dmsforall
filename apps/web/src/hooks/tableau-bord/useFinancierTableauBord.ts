import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { FiltreTableauBord, ReponseFinancierTableauBord } from '@dfa/shared';

import { clesTableauBord } from './cles';
import { recupererFinancierTableauBord } from './tableau-bord.api';

/**
 * `GET /tableau-bord/financier` — RÉSERVÉ `direction`/`comptable` (RF-115, `admin` explicitement
 * exclu, séparation des pouvoirs délibérée). `autorise` PILOTE `enabled` : défense en profondeur
 * en plus du masquage du composant appelant (`role_autorisé ? <BlocFinancierTableauBord/> : null`
 * dans `EcranTableauBord.tsx`) — même si le composant qui monte ce hook n'est de toute façon rendu
 * QUE pour un rôle autorisé, ce hook ne doit JAMAIS déclencher la requête pour un rôle qu'on sait
 * non autorisé. Les deux mécanismes se recouvrent volontairement (même doctrine que le reste du
 * dépôt : le masquage front est un confort, le 403 serveur est l'arbitre réel).
 */
export function useFinancierTableauBord(
  filtre: FiltreTableauBord,
  autorise: boolean,
): UseQueryResult<ReponseFinancierTableauBord> {
  return useQuery({
    // Liste/état critique du poste : toujours frais, rechargé au retour sur l'onglet (le défaut du
    // QueryClient — 30 s, sans rechargement au focus — ne s'applique pas ici).
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: clesTableauBord.financier(filtre),
    queryFn: () => recupererFinancierTableauBord(filtre),
    enabled: autorise,
  });
}
