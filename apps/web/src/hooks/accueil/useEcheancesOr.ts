import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { listerEcheancesOr, type FiltresEcheancesOr } from './echeances-or.api';

/** `GET /ordres-reparation` borné sur une fenêtre de restitution promise — clé de cache dérivée de
 *  `clesQuery.or.liste` (fabrique gelée, `api/cles.ts` : forme ouverte `FiltresListe`, aucune
 *  modification de ce fichier n'était nécessaire pour l'y faire entrer).
 *
 *  `options.enabled` : à `false` tant que le droit `atelier.or.lire` n'est pas acquis pour le
 *  rôle courant (`peutLireEcheancesOr`, `ecrans/accueil/droits.ts`) — même garde que
 *  `useJeuxARelancer`/`useListeDossiersVente` : un rôle sans le droit ne déclenche jamais la
 *  requête. */
export function useEcheancesOr(
  filtres: FiltresEcheancesOr,
  options?: { readonly enabled?: boolean },
): UseQueryResult<PageCurseur<OrdreReparationResume>> {
  return useQuery({
    queryKey: clesQuery.or.liste({ ...filtres, portee: 'accueil-echeances' }),
    queryFn: () => listerEcheancesOr(filtres),
    enabled: options?.enabled ?? true,
  });
}
