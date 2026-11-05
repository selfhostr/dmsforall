import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseParametresPieces } from '@dfa/shared';

import { requeteApi } from '@/api/client';

import { clesPieces } from './cles';

async function recupererParametresPieces(): Promise<ReponseParametresPieces> {
  const reponse = await requeteApi<ReponseParametresPieces>('/parametrage/pieces', {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse de paramètres pièces inattendue : corps vide.');
  }
  return reponse;
}

/**
 * Singleton du tenant (`GET /parametrage/pieces`, §10 `PP-01` → `PP-08`) — seuils de
 * réapprovisionnement, méthode de prix d'achat, visibilité du stock inter-sites. Même convention
 * que `hooks/parametres/useParametresAtelier.ts` (`staleTime` long : un paramétrage change
 * rarement en cours de service). Placé dans `hooks/pieces/` (pas `hooks/parametres/`, hors
 * périmètre de ce lot) : le paramétrage pièces est un sous-domaine de `pieces`, pas du
 * paramétrage atelier partagé.
 */
export function useParametresPieces(): UseQueryResult<ReponseParametresPieces> {
  return useQuery({
    queryKey: clesPieces.parametrage(),
    queryFn: recupererParametresPieces,
    staleTime: 5 * 60 * 1000,
  });
}
