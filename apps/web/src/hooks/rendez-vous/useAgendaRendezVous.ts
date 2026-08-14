import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseRendezVous } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { listerRendezVous, type FiltresPeriodeRendezVous } from './rendez-vous.api';

/** `GET /rendez-vous` sur une période — clé de cache `clesQuery.rdv.plage` (fabrique gelée,
 *  `api/cles.ts`, réservée à ce domaine dès la vague 0). `enabled` reste à `false` tant que le site
 *  n'est pas connu (§Écran 1 : « Choisissez un site », jamais une requête devinée). */
export function useAgendaRendezVous(
  filtres: FiltresPeriodeRendezVous | undefined,
): UseQueryResult<PageCurseur<ReponseRendezVous>> {
  return useQuery({
    queryKey: filtres
      ? clesQuery.rdv.plage(filtres.siteId, filtres.du, filtres.au)
      : clesQuery.rdv.plage('', '', ''),
    queryFn: () => listerRendezVous(filtres as FiltresPeriodeRendezVous),
    enabled: filtres !== undefined,
  });
}
