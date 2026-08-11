import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseModelesVehiculesCh } from '@dfa/shared';

import { useDoitReessayer } from '@/hooks/pagination-curseur';

import { rechercherModelesVehicules } from './referentiel-vehicules.api';

// Même doctrine que `useMarquesVehicule.ts` pour la clé locale (hors `@/api/cles.ts`, gelé et
// hors périmètre) : voir son commentaire, non répété ici.
const cleModelesVehicule = (marque: string, recherche: string) =>
  ['vehicules', 'referentielModeles', marque, recherche] as const;

/**
 * `GET /referentiels/vehicules/modeles` — suggestions pour l'autocomplétion du modèle, conditionnées
 * par la marque (mode 2 de la doctrine de saisie, cascade marque → modèle). `marque` ET `recherche`
 * sont déjà temporisées par l'appelant (`useValeurDebouncee`, sur les DEUX champs) — la marque
 * temporisée pilote aussi bien l'activation de la requête que son paramètre `marque`, jamais la
 * valeur brute en cours de frappe (§ contrat : `marque` obligatoire côté serveur).
 */
export function useModelesVehicule(
  marque: string,
  recherche: string,
  options: { readonly enabled: boolean },
): UseQueryResult<ReponseModelesVehiculesCh> {
  const reessayer = useDoitReessayer();
  return useQuery({
    queryKey: cleModelesVehicule(marque, recherche),
    queryFn: ({ signal }) => rechercherModelesVehicules(marque, recherche, signal),
    enabled: options.enabled,
    retry: reessayer,
  });
}
