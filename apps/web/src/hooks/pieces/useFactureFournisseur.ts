import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseFactureFournisseur } from '@dfa/shared';

import { clesPieces } from './cles';
import { recupererFactureFournisseur } from './factures-fournisseur.temporaire';

/** `GET /factures-fournisseur/{id}` (contrat temporaire) — même convention que
 *  `useCommandeFournisseur` : `enabled: false` tant que l'identifiant de route n'est pas résolu. */
export function useFactureFournisseur(
  id: string | undefined,
): UseQueryResult<ReponseFactureFournisseur> {
  return useQuery({
    queryKey: clesPieces.facturesFournisseur.detail(id ?? ''),
    queryFn: () => recupererFactureFournisseur(id as string),
    enabled: id !== undefined,
  });
}
