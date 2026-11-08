import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponsePaiement } from '@dfa/shared';

import { requeteApi } from '@/api/client';

import { clesFacturation } from './cles';

/** `GET /paiements?documentId=…` — paiements imputés (au moins une imputation) à CE document. Le
 *  filtre est appliqué en SQL par l'API (`service-paiement.ts`). Une facture reçoit rarement plus
 *  de quelques paiements : une seule page de 100 suffit. */
export function useListePaiementsDocument(
  documentId: string | undefined,
): UseQueryResult<readonly ReponsePaiement[]> {
  return useQuery({
    queryKey: clesFacturation.documents.paiements(documentId ?? ''),
    enabled: Boolean(documentId),
    queryFn: async () => {
      const reponse = await requeteApi<PageCurseur<ReponsePaiement>>(
        `/paiements?documentId=${encodeURIComponent(documentId as string)}&limite=100&tri=dateValeur:asc`,
        { method: 'GET' },
      );
      return reponse?.donnees ?? [];
    },
  });
}
