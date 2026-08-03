import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseDisponibiliteArticle } from '@dfa/shared';

import { clesPieces } from './cles';
import { recupererDisponibiliteArticle } from './stock.api';

/** `GET /articles/{id}/disponibilite?siteId=` — nomme les réservations actives, le terrain de
 *  CP-02. `enabled` seulement quand les DEUX identifiants sont résolus. */
export function useDisponibiliteArticle(articleId: string | undefined, siteId: string | undefined): UseQueryResult<ReponseDisponibiliteArticle> {
  return useQuery({
    queryKey: clesPieces.articles.disponibilite(articleId ?? '', siteId ?? ''),
    queryFn: () => recupererDisponibiliteArticle(articleId as string, siteId as string),
    enabled: articleId !== undefined && siteId !== undefined,
  });
}
