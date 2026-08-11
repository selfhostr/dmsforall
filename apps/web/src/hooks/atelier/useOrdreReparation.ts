import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseOrdreReparation } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { useDoitReessayer } from '@/hooks/pagination-curseur';

import { recupererOrdreReparation } from './ordres-reparation.api';

/** `GET /ordres-reparation/{id}` — le document complet (D-10). Rafraîchi directement par
 *  `setQueryData` après chaque transition (`useTransitionsOrdreReparation.ts`) : l'écran n'a
 *  jamais à relire après une action réussie.
 *
 * `retry: reessayer` (issue #46, même défaut repéré sur `useListeOrdresReparation.ts` en vérifiant
 * le reste de ce répertoire) : un 403/404 sur une fiche est aussi un refus STABLE, jamais résolu
 * par un réessai — même correctif que `useClient` (`hooks/clients/`). */
export function useOrdreReparation(
  orId: string | undefined,
): UseQueryResult<ReponseOrdreReparation> {
  const reessayer = useDoitReessayer();
  return useQuery({
    queryKey: clesQuery.or.detail(orId ?? ''),
    queryFn: () => recupererOrdreReparation(orId as string),
    enabled: Boolean(orId),
    retry: reessayer,
  });
}
