import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { clesTableauBord } from './cles';
import { compterOrEnAttentePieces } from './or-attente-pieces.api';

/** Nombre d'OR actifs actuellement bloqués faute de pièce (issue #74) — voir la doc de
 *  `compterOrEnAttentePieces` (`or-attente-pieces.api.ts`) pour la méthode et ses limites
 *  assumées : approximation client tant qu'aucun snapshot serveur dédié n'existe. */
export function useOrEnAttentePieces(site: string | undefined): UseQueryResult<number> {
  return useQuery({
    queryKey: clesTableauBord.orEnAttentePieces(site),
    queryFn: () => compterOrEnAttentePieces({ siteId: site }),
  });
}
