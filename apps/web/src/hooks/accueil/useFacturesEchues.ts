import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { DocumentVenteResume, PageCurseur } from '@dfa/shared';

import { listerDocumentsVente } from '@/hooks/facturation/documents-vente.api';

const LIMITE = 6;

/**
 * Factures émises dont l'échéance est dépassée et dont le solde est dû (filtre serveur `enRetard`,
 * même définition que la liste des factures), les plus grosses d'abord.
 */
export function useFacturesEchues(
  siteId: string | undefined,
  options?: { readonly enabled?: boolean },
): UseQueryResult<PageCurseur<DocumentVenteResume>> {
  return useQuery({
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: ['facturation', 'documents', 'accueil-echues', siteId ?? null],
    queryFn: () =>
      listerDocumentsVente(
        { siteId, typeDocument: ['facture'], enRetard: true, tri: 'soldeCentimes:desc' },
        { limite: LIMITE },
      ),
    enabled: options?.enabled ?? true,
  });
}
