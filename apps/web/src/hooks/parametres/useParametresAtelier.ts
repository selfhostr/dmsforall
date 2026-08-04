import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseParametresAtelier } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';

async function recupererParametresAtelier(): Promise<ReponseParametresAtelier> {
  const reponse = await requeteApi<ReponseParametresAtelier>('/parametres-atelier', {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse de paramètres atelier inattendue : corps vide.');
  }
  return reponse;
}

/**
 * Singleton du tenant (`GET /parametres-atelier`) : unité de temps, plafond de réception par
 * défaut, politiques diverses et `fonctionnalites` (drapeau d'étape, toutes `false` au lot 1).
 * Lu par TOUT écran qui affiche ou valide un réglage — jamais redéfini localement.
 *
 * `staleTime` volontairement long : un paramétrage change rarement en cours de service (un
 * garagiste ne modifie pas sa politique de contrôle qualité entre deux OR) ; une requête par
 * écran ouvert serait un coût réseau sans bénéfice pour la fraîcheur perçue. Une modification
 * (hors périmètre de ce hook, en lecture seule) invalidera `clesQuery.parametres.atelier()`
 * explicitement plutôt que de compter sur l'expiration.
 */
export function useParametresAtelier(): UseQueryResult<ReponseParametresAtelier> {
  return useQuery({
    queryKey: clesQuery.parametres.atelier(),
    queryFn: recupererParametresAtelier,
    staleTime: 5 * 60 * 1000,
  });
}
