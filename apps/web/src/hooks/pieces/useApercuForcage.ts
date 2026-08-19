import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseApercuForcageMouvement } from '@dfa/shared';

import { clesPieces } from './cles';
import { recupererApercuForcage } from './mouvements.api';

/**
 * `GET /articles/{id}/mouvements/apercu-forcage` — DÉFAUT CORRIGÉ (test manuel du 14.08.2026,
 * défaut n°2) : lit, AVANT soumission, les réservations qu'un forçage libérerait — voir
 * `DialogueMouvementStock.tsx` pour l'usage (interrogé UNIQUEMENT quand « Forcer » est coché et
 * que site/quantité sont renseignés, `enabled` ci-dessous). `articleId` non résolu -> désactivé,
 * même convention que `useDisponibiliteArticle`.
 */
export function useApercuForcage(
  articleId: string | undefined,
  siteId: string,
  quantiteMillieme: number | null,
  actif: boolean,
): UseQueryResult<ReponseApercuForcageMouvement> {
  return useQuery({
    queryKey: clesPieces.articles.apercuForcage(articleId ?? '', siteId, quantiteMillieme ?? 0),
    queryFn: () =>
      recupererApercuForcage(articleId as string, {
        siteId,
        quantiteMillieme: quantiteMillieme as number,
      }),
    enabled:
      actif &&
      articleId !== undefined &&
      siteId !== '' &&
      quantiteMillieme !== null &&
      quantiteMillieme > 0,
  });
}
