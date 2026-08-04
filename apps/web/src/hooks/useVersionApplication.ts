import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { clesQuery } from '@/api/cles';
import { recupererSante, type ReponseSante } from '@/api/sante';

/**
 * Numéro de version affiché en bas de la barre latérale (support téléphonique : « quelle
 * version tourne chez ce garage ? »). Source = l'API (`GET /sante`), jamais le `package.json`
 * du front lu à la compilation — c'est le backend qui porte les migrations et les règles
 * métier, voir la décision de tâche.
 *
 * `staleTime: Infinity` + `refetchOnWindowFocus: false` : cette valeur ne change qu'au
 * déploiement (donc à un rechargement complet de l'app, qui réinitialise de toute façon le
 * cache TanStack Query), jamais en cours de session — inutile de la redemander à chaque
 * navigation entre écrans ou changement d'onglet.
 */
export function useVersionApplication(): UseQueryResult<ReponseSante> {
  return useQuery({
    queryKey: clesQuery.sante.version(),
    queryFn: recupererSante,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
