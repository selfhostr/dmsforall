import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseMarquesVehiculesCh } from '@dfa/shared';

import { FRAICHEUR_REFERENTIEL_MS } from '@/api/reessai';
import { useDoitReessayer } from '@/hooks/pagination-curseur';

import { rechercherMarquesVehicules } from './referentiel-vehicules.api';

// Clé LOCALE, volontairement hors `@/api/cles.ts` (`clesQuery`) : cette fabrique est gelée
// (vague 0, voir son en-tête) et `apps/web/src/api/` est hors du périmètre d'écriture de cette
// livraison (lot NestJS en parallèle sur `apps/api`/`packages/shared` ; le périmètre React de
// cette livraison est limité à `composants|ecrans|hooks/vehicules` + i18n — voir le brief).
// Préfixe `referentielMarques` distinct de `clesQuery.vehicules.*` pour ne jamais collisionner ;
// à fusionner dans `clesQuery` par le propriétaire de ce fichier lors d'une prochaine livraison.
const cleMarquesVehicule = (recherche: string) =>
  ['vehicules', 'referentielMarques', recherche] as const;

/**
 * `GET /referentiels/vehicules/marques` — suggestions pour l'autocomplétion de la marque
 * (`ChampAutocompletionVehicule`, composants/vehicules/). `recherche` est déjà temporisée par
 * l'appelant (`useValeurDebouncee`, `hooks/commun/`) : ce hook ne fait qu'émettre la requête pour
 * la valeur reçue, TanStack Query annule lui-même la requête en vol dès que `recherche` change à
 * nouveau (signal transmis à `queryFn`, voir `referentiel-vehicules.api.ts`) — pas de requête
 * obsolète qui écraserait une réponse plus récente.
 */
export function useMarquesVehicule(
  recherche: string,
  options: { readonly enabled: boolean },
): UseQueryResult<ReponseMarquesVehiculesCh> {
  const reessayer = useDoitReessayer();
  return useQuery({
    queryKey: cleMarquesVehicule(recherche),
    queryFn: ({ signal }) => rechercherMarquesVehicules(recherche, signal),
    enabled: options.enabled,
    retry: reessayer,
    staleTime: FRAICHEUR_REFERENTIEL_MS,
  });
}
