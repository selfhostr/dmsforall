import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { OrdreReparationResume, PageCurseur, StatutOrdreReparation } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { chargeurSousCollectionClient } from './support';

export interface FiltresOrClient {
  readonly statut?: readonly StatutOrdreReparation[];
  readonly tri?: 'ouvertLe:desc' | 'ouvertLe:asc';
}

/** `GET /clients/{id}/ordres-reparation` — onglet « Derniers passages à l'atelier » (RM-21 : les
 *  OR restent attachés au client de l'époque, même après une fusion). */
export function useOrdresClient(
  clientId: string | undefined,
  filtres: FiltresOrClient = {},
): UseInfiniteQueryResult<InfiniteData<PageCurseur<OrdreReparationResume>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<OrdreReparationResume>({
    cle: clesQuery.clients.ordres(clientId ?? ''),
    charger: clientId
      ? chargeurSousCollectionClient(
          clientId,
          'ordres-reparation',
          { tri: filtres.tri ?? 'ouvertLe:desc' },
          { statut: filtres.statut },
        )
      : undefined,
    reessayer,
  });
  return resultat;
}
