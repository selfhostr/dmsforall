import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseClientCondition } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { chargeurSousCollectionClient } from './support';

/** `GET /clients/{id}/conditions` (RM-07, conditions DATÉES) — onglet « Conditions
 *  commerciales » de la fiche. Lecture seule au lot 1 : aucune action « ajouter » au contrat
 *  (voir `clients:conditions`, i18n, qui ne porte pas de clé `ajouter`, contrairement aux autres
 *  sous-collections). */
export function useConditionsClient(
  clientId: string | undefined,
): UseInfiniteQueryResult<InfiniteData<PageCurseur<ReponseClientCondition>>, unknown> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<ReponseClientCondition>({
    cle: clesQuery.clients.conditions(clientId ?? ''),
    charger: clientId ? chargeurSousCollectionClient(clientId, 'conditions') : undefined,
    reessayer,
  });
  return resultat;
}
