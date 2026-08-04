import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseDossierVente } from '@dfa/shared';

import { clesVentesDossiers } from './cles';
import { recupererDossierVente } from './dossiers-vente.api';

/** `GET /dossiers-vente/{id}` — même convention que `useArticle`/`useVehicule` : `enabled: false`
 *  tant que l'identifiant de route n'est pas résolu. */
export function useDossierVente(id: string | undefined): UseQueryResult<ReponseDossierVente> {
  return useQuery({
    queryKey: clesVentesDossiers.detail(id ?? ''),
    queryFn: () => recupererDossierVente(id as string),
    enabled: id !== undefined,
  });
}
