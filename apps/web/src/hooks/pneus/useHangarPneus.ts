import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseDepotPneus } from '@dfa/shared';

import { useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPneus } from './cles';
import { recupererHangarPneus, type FiltresHangar } from './depot-pneus.api';

const LIMITE_PAGE = 50;

export type ResultatHangarPneus = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseDepotPneus>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement,
   *  même convention que `useListeArticles`/`useListeVehicules`. */
  readonly depots: readonly ReponseDepotPneus[];
};

/** `GET /sites/{siteId}/hangar-pneus` — vue hangar du site (spec §5, §6), pagination par
 *  curseur (`BoutonChargerPlus`). */
export function useHangarPneus(
  siteId: string | undefined,
  filtres: FiltresHangar,
): ResultatHangarPneus {
  const { resultat, elements } = useListeCurseur<ReponseDepotPneus>({
    cle: clesPneus.hangar.liste(siteId ?? '', filtres),
    charger:
      siteId === undefined
        ? undefined
        : (curseur) => recupererHangarPneus(siteId, filtres, { limite: LIMITE_PAGE, curseur }),
  });

  return { ...resultat, depots: elements };
}
