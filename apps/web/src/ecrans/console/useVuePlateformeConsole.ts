import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReponseSantePlateforme } from '@dfa/shared';

import { clesConsole } from './cles';
import { recupererSantePlateformeConsole } from './console.api';

/**
 * `GET /exploitation/sante-plateforme`. Rafraîchissement automatique toutes les 30 s : c'est un
 * tableau de bord de supervision consulté « sous pression » (§0 de la conception), pas une liste
 * métier consultée puis laissée statique — contrairement à `useReglesRelance`/`useParametresPieces`
 * (staleTime long, un réglage change rarement), ici l'état qu'on regarde peut changer PENDANT
 * qu'on l'a sous les yeux (un export qui repart, une relance qui part enfin). `refetchOnWindowFocus`
 * reste actif par défaut (revient sur l'onglet après avoir raccroché ailleurs -> revalidation
 * immédiate, sans attendre les 30 s).
 */
export function useVuePlateformeConsole(): UseQueryResult<ReponseSantePlateforme> {
  return useQuery({
    queryKey: clesConsole.vuePlateforme(),
    queryFn: recupererSantePlateformeConsole,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
