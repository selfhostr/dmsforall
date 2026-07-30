import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseDocumentVente } from '@dfa/shared';

import { clesFacturation } from './cles';
import { recupererDocumentVente } from './documents-vente.api';

/** `GET /documents-vente/{id}` — utilisé par les écrans 2 (fiche facture) et 4 (avoir, pour lire
 *  la facture d'origine). Rafraîchi directement par `setQueryData` après émission/correction —
 *  l'écran n'a jamais à relire après une action réussie (même principe que `useOrdreReparation`). */
export function useDocumentVente(id: string | undefined): UseQueryResult<ReponseDocumentVente> {
  return useQuery({
    queryKey: clesFacturation.documents.detail(id ?? ''),
    queryFn: () => recupererDocumentVente(id as string),
    enabled: Boolean(id),
  });
}
