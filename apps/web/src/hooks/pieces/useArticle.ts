import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseArticle } from '@dfa/shared';

import { clesPieces } from './cles';
import { recupererArticle } from './articles.api';

/** `GET /articles/{id}` — même convention que `useVehicule`/`useClient` : `enabled: false` tant
 *  que l'identifiant de route n'est pas résolu (jamais d'appel avec un id `undefined`). */
export function useArticle(articleId: string | undefined): UseQueryResult<ReponseArticle> {
  return useQuery({
    queryKey: clesPieces.articles.detail(articleId ?? ''),
    queryFn: () => recupererArticle(articleId as string),
    enabled: articleId !== undefined,
  });
}
