import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { recupererFournisseur } from './fournisseurs.api';

/** `GET /fournisseurs/{id}` — même convention que `useArticle` : `enabled: false` tant que
 *  l'identifiant de route n'est pas résolu. */
export function useFournisseur(id: string | undefined): UseQueryResult<ReponseFournisseur> {
  return useQuery({
    queryKey: clesPieces.fournisseurs.detail(id ?? ''),
    queryFn: () => recupererFournisseur(id as string),
    enabled: id !== undefined,
  });
}
