import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import {
  TRI_DEFAUT_REAPPROVISIONNEMENT,
  type FiltresReapprovisionnement,
  type LigneReapprovisionnement,
  type PageCurseur,
} from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import { listerReapprovisionnement } from './stock.api';

const LIMITE_PAGE = 50;

export type ResultatReapprovisionnement = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<LigneReapprovisionnement>[] },
  unknown
> & {
  readonly lignes: readonly LigneReapprovisionnement[];
};

/** `GET /stock/reapprovisionnement?siteId=` (RP-12) — propose, ne commande jamais
 *  automatiquement. `enabled: false` tant qu'aucun site n'est sélectionné. `reessayer` : RF-115,
 *  `admin` porte `[]` sur tout le domaine Pièces (`matrice-droits.ts`), même raison que
 *  `useListeArticles`. */
export function useReapprovisionnement(siteId: string | undefined): ResultatReapprovisionnement {
  const filtres: FiltresReapprovisionnement = {
    siteId: siteId ?? '',
    tri: TRI_DEFAUT_REAPPROVISIONNEMENT,
    limite: LIMITE_PAGE,
  };
  const reessayer = useDoitReessayer();

  const { resultat, elements } = useListeCurseur<LigneReapprovisionnement>({
    cle: clesPieces.stock.reapprovisionnement(filtres),
    charger:
      siteId === undefined
        ? undefined
        : (curseur) =>
            listerReapprovisionnement(
              { siteId, tri: filtres.tri },
              { limite: LIMITE_PAGE, curseur },
            ),
    reessayer,
  });

  return { ...resultat, lignes: elements };
}
