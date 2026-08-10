import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseDepotPneus } from '@dfa/shared';

import { useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPneus } from './cles';
import { listerDepotsPneusARelancer, type FiltresARelancer } from './depot-pneus.api';

const LIMITE_PAGE = 50;

export type ResultatJeuxARelancer = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseDepotPneus>[] },
  unknown
> & {
  readonly depots: readonly ReponseDepotPneus[];
};

/** `GET /depots-pneus/a-relancer` (RPP-04) — jeux oubliés depuis plus de deux ans (délai serveur,
 *  §3 de la spec), site ou tenant entier selon `filtres.siteId`.
 *
 *  `options.enabled` (facultatif, défaut `true` — comportement inchangé si omis) : à passer
 *  `false` par l'appelant tant que l'onglet correspondant n'est pas actif, même garde que
 *  `useListeClients`/`useHangarPneus`/`useListePointages`. Ne PAS conditionner cette garde à la
 *  présence d'un site : `filtres.siteId` est facultatif ici (tenant entier si omis), contrairement
 *  à `useHangarPneus` où le site est une entrée obligatoire. */
export function useJeuxARelancer(
  filtres: FiltresARelancer,
  options?: { readonly enabled?: boolean },
): ResultatJeuxARelancer {
  const { resultat, elements } = useListeCurseur<ReponseDepotPneus>({
    cle: clesPneus.aRelancer.liste(filtres),
    charger: (curseur) => listerDepotsPneusARelancer(filtres, { limite: LIMITE_PAGE, curseur }),
    actif: options?.enabled,
  });

  return { ...resultat, depots: elements };
}
