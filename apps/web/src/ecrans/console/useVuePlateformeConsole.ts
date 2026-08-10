import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReponseSantePlateforme } from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';

import { clesConsole } from './cles';
import { recupererSantePlateformeConsole } from './console.api';

/**
 * Catégorise l'échec de `GET /exploitation/sante-plateforme` pour distinguer trois familles qui ne
 * doivent NI s'afficher pareil NI se retenter pareil :
 * - `moduleInactif` (404) : la console d'exploitation est éteinte par défaut côté serveur
 *   (`DATABASE_URL_CONSOLE` absente) — usage NOMINAL, pas une panne. Retenter ne change rien tant
 *   que le serveur n'est pas reconfiguré.
 * - `accesRefuse` (401/403) : le rôle de la session ne donne pas accès — une donnée stable, pas un
 *   échec transitoire à retenter (même logique que `useSession`).
 * - `autre` : tout le reste (500, réseau coupé…), la seule famille réellement transitoire.
 *
 * Branché sur `probleme.status`, jamais sur `probleme.code` : un 404 générique Nest (module non
 * monté) n'est pas envoyé en `application/problem+json`, donc `construireErreurApi` synthétise
 * `ERREUR_INTERNE` — mais préserve `status: 404` depuis la réponse HTTP réelle. `code` mentirait
 * ici, `status` reste vrai.
 */
export type CategorieErreurConsole = 'moduleInactif' | 'accesRefuse' | 'autre';

export function categoriserErreurConsole(erreur: unknown): CategorieErreurConsole {
  if (erreur instanceof ErreurApi) {
    if (erreur.probleme.status === 404) return 'moduleInactif';
    if (erreur.probleme.status === 401 || erreur.probleme.status === 403) return 'accesRefuse';
  }
  return 'autre';
}

/**
 * `GET /exploitation/sante-plateforme`. Rafraîchissement automatique toutes les 30 s : c'est un
 * tableau de bord de supervision consulté « sous pression » (§0 de la conception), pas une liste
 * métier consultée puis laissée statique — contrairement à `useReglesRelance`/`useParametresPieces`
 * (staleTime long, un réglage change rarement), ici l'état qu'on regarde peut changer PENDANT
 * qu'on l'a sous les yeux (un export qui repart, une relance qui part enfin). `refetchOnWindowFocus`
 * reste actif par défaut (revient sur l'onglet après avoir raccroché ailleurs -> revalidation
 * immédiate, sans attendre les 30 s).
 *
 * `refetchInterval` coupé (`false`) quand l'erreur est stable (`moduleInactif`/`accesRefuse`) : sans
 * ça, l'auto-refresh relance la même requête vouée au même échec toutes les 30 s, ce qui donne
 * l'illusion visuelle d'une panne permanente sur un module simplement éteint. Reste actif pour
 * l'état sain et pour une erreur `autre` (transitoire, potentiellement résolue au prochain tick).
 * `retry: false` explicite (même pattern que `useSession`/`useBlocCreancier`) : un 404/403 est une
 * donnée stable, pas un échec transitoire à retenter — et ça évite trois tentatives avec backoff
 * avant que l'écran ne se stabilise (le défaut TanStack hérité de `App.tsx`, `QueryClient()` sans
 * options).
 */
export function useVuePlateformeConsole(): UseQueryResult<ReponseSantePlateforme> {
  return useQuery({
    queryKey: clesConsole.vuePlateforme(),
    queryFn: recupererSantePlateformeConsole,
    staleTime: 15_000,
    retry: false,
    refetchInterval: (query) =>
      categoriserErreurConsole(query.state.error) === 'autre' ? 30_000 : false,
  });
}
