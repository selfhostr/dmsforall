import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseParametresSite } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';

async function recupererParametresSite(siteId: string): Promise<ReponseParametresSite> {
  const reponse = await requeteApi<ReponseParametresSite>(`/sites/${siteId}/parametres-atelier`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse de paramètres de site inattendue : corps vide.');
  }
  return reponse;
}

/**
 * Paramètres de NIVEAU SITE (`GET /sites/{siteId}/parametres-atelier`) : capacité horaire
 * journalière (P-20), heure de clôture automatique des pointages (P-31), horaires et fermetures.
 * Équivalent site de `useParametresAtelier`, mais scopé — un tenant multi-sites peut avoir des
 * réglages différents par site (RM du plan atelier).
 *
 * `siteId` est optionnel côté signature pour permettre l'appel depuis un écran dont le site
 * courant n'est pas encore connu (session en cours de résolution) sans que l'appelant ait à
 * gérer une garde `if (siteId)` séparée : la requête reste simplement `enabled: false` tant que
 * `siteId` est absent, comme `useRechercheComptoir` le fait pour son terme de recherche.
 */
export function useParametresSite(
  siteId: string | undefined,
): UseQueryResult<ReponseParametresSite> {
  return useQuery({
    queryKey: clesQuery.parametres.site(siteId ?? ''),
    queryFn: () => recupererParametresSite(siteId as string),
    enabled: siteId !== undefined && siteId.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
