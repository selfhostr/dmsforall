import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type {
  AttenteOrdreReparation,
  OrdreReparationResume,
  PageCurseur,
  StatutOrdreReparation,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { listerOrdresReparation } from '@/hooks/atelier/ordres-reparation.api';

export interface FiltreOrAFaire {
  readonly statut?: StatutOrdreReparation;
  readonly attente?: AttenteOrdreReparation;
  readonly siteId?: string;
}

const LIMITE = 6;

/**
 * Quelques OR (les plus anciens d'abord) pour un bloc « à faire » de l'accueil : terminés à facturer,
 * en attente d'accord client. Une liste courte et fraîche, pas la liste complète — le lien « Tout
 * voir » mène à l'écran des OR.
 */
export function useOrParFiltre(
  filtre: FiltreOrAFaire,
  options?: { readonly enabled?: boolean },
): UseQueryResult<PageCurseur<OrdreReparationResume>> {
  return useQuery({
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: clesQuery.or.liste({ ...filtre, portee: 'accueil-a-faire' }),
    queryFn: () => listerOrdresReparation({ ...filtre, tri: 'ouvertLe:asc' }, { limite: LIMITE }),
    enabled: options?.enabled ?? true,
  });
}
