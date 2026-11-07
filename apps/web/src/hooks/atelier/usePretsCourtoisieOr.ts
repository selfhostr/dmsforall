import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponsePretCourtoisie } from '@dfa/shared';

import { listerPretsCourtoisie } from '@/hooks/courtoisie/courtoisie.api';

/**
 * Prêts de voiture de courtoisie rattachés à un OR (`GET /courtoisie/prets?ordreReparationId=`).
 * Clé sous `['courtoisie']` : toute mutation de prêt (créer, rendre, annuler) la relit d'elle-même.
 * `actif` à `false` (droit `courtoisie.lire` absent) : aucune requête.
 */
export function usePretsCourtoisieOr(
  orId: string,
  actif: boolean,
): UseQueryResult<PageCurseur<ReponsePretCourtoisie>> {
  return useQuery({
    queryKey: ['courtoisie', 'prets', 'or', orId],
    queryFn: () => listerPretsCourtoisie({ ordreReparationId: orId }),
    enabled: actif,
  });
}
