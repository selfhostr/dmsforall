import { type InfiniteData, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageUtilisateurResume, UtilisateurResume } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { clesQuery } from '@/api/cles';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { exigerCorps } from './support';

const LIMITE_PAR_PAGE = 50;

/** `GET /utilisateurs` — liste des employés du tenant (issue #137). Pas de filtre : l'écran
 *  affiche tout le monde d'un coup d'œil (patrons de garages en ont rarement plus de quelques
 *  dizaines), même patron « chargement complet, pas de recherche » que `useListeSites` si un jour
 *  il existe. */
export function useListeUtilisateurs(): UseInfiniteQueryResult<
  InfiniteData<PageUtilisateurResume>,
  unknown
> {
  const reessayer = useDoitReessayer();
  const { resultat } = useListeCurseur<UtilisateurResume>({
    cle: clesQuery.utilisateurs.liste(),
    charger: async (curseur) => {
      const params = new URLSearchParams({ limite: String(LIMITE_PAR_PAGE) });
      if (curseur) params.set('curseur', curseur);
      const page = await requeteApi<PageUtilisateurResume>(`/utilisateurs?${params.toString()}`, {
        method: 'GET',
      });
      return exigerCorps(page, 'GET /utilisateurs');
    },
    reessayer,
  });
  return resultat;
}
