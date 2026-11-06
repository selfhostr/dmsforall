import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { FiltreTableauBord, ReponseActiviteTableauBord } from '@dfa/shared';

import { clesTableauBord } from './cles';
import { recupererActiviteTableauBord } from './tableau-bord.api';

/** `GET /tableau-bord/activite` — ouvert à tout rôle de PERSONNE sauf `poste_atelier`. Aucun
 *  `enabled` conditionnel ici : contrairement au bloc financier, ce bloc est TOUJOURS rendu pour
 *  tout rôle qui atteint la route (garde posée par `RouteProtegee` dans `routeur.tsx`), donc ce
 *  hook n'a pas besoin de sa propre défense en profondeur. */
export function useActiviteTableauBord(
  filtre: FiltreTableauBord,
): UseQueryResult<ReponseActiviteTableauBord> {
  return useQuery({
    // Liste/état critique du poste : toujours frais, rechargé au retour sur l'onglet (le défaut du
    // QueryClient — 30 s, sans rechargement au focus — ne s'applique pas ici).
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: clesTableauBord.activite(filtre),
    queryFn: () => recupererActiviteTableauBord(filtre),
  });
}
