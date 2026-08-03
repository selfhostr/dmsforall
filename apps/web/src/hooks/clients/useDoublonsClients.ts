import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseDoublonsClients } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';

import { construireRequete, exigerCorps } from './support';

export interface CriteresDoublonsClients {
  readonly nom?: string;
  readonly npa?: string;
  readonly email?: string;
  readonly telephoneMobile?: string;
  readonly ide?: string;
  readonly exclureClientId?: string;
}

function auMoinsUnCritere(criteres: CriteresDoublonsClients): boolean {
  return Boolean(
    criteres.nom ?? criteres.npa ?? criteres.email ?? criteres.telephoneMobile ?? criteres.ide,
  );
}

/** `GET /doublons-clients` (RM-05) — projection non paginée, consommée à la frappe dans le
 *  formulaire de création. `enabled` exige au moins un critère (miroir de
 *  `schemaParametresDoublonsClients.refine`, `@dfa/shared`) : appeler l'endpoint sans critère
 *  produirait un `400` systématique, pas une liste vide. C'est un AVERTISSEMENT (CT-01), jamais
 *  un blocage : deux frères à la même adresse restent deux clients légitimes. */
export function useDoublonsClients(
  criteres: CriteresDoublonsClients,
): UseQueryResult<ReponseDoublonsClients> {
  const actif = auMoinsUnCritere(criteres);
  return useQuery({
    queryKey: clesQuery.clients.doublons(JSON.stringify(criteres)),
    queryFn: async () => {
      const params = construireRequete({
        nom: criteres.nom,
        npa: criteres.npa,
        email: criteres.email,
        telephoneMobile: criteres.telephoneMobile,
        ide: criteres.ide,
        exclureClientId: criteres.exclureClientId,
      });
      const reponse = await requeteApi<ReponseDoublonsClients>(
        `/doublons-clients?${params.toString()}`,
        {
          method: 'GET',
        },
      );
      return exigerCorps(reponse, 'GET /doublons-clients');
    },
    enabled: actif,
    staleTime: 30_000,
  });
}
