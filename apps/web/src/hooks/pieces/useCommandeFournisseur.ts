import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseCommandeFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { recupererCommandeFournisseur } from './commandes-fournisseur.api';

/** `GET /commandes-fournisseur/{id}` — même convention que `useArticle` : `enabled: false` tant
 *  que l'identifiant de route n'est pas résolu. */
export function useCommandeFournisseur(
  id: string | undefined,
): UseQueryResult<ReponseCommandeFournisseur> {
  return useQuery({
    queryKey: clesPieces.commandesFournisseur.detail(id ?? ''),
    queryFn: () => recupererCommandeFournisseur(id as string),
    enabled: id !== undefined,
  });
}
