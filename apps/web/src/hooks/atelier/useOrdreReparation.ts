import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseOrdreReparation } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { recupererOrdreReparation } from './ordres-reparation.api';

/** `GET /ordres-reparation/{id}` — le document complet (D-10). Rafraîchi directement par
 *  `setQueryData` après chaque transition (`useTransitionsOrdreReparation.ts`) : l'écran n'a
 *  jamais à relire après une action réussie. */
export function useOrdreReparation(orId: string | undefined): UseQueryResult<ReponseOrdreReparation> {
  return useQuery({
    queryKey: clesQuery.or.detail(orId ?? ''),
    queryFn: () => recupererOrdreReparation(orId as string),
    enabled: Boolean(orId),
  });
}
