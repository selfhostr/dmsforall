import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { FiltresConsignes, PageCurseur, ReponseConsigneEchangeStandard } from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import { listerConsignes } from './consignes.api';

const LIMITE_PAGE = 50;

export type ResultatConsignes = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseConsigneEchangeStandard>[] },
  unknown
> & {
  readonly consignes: readonly ReponseConsigneEchangeStandard[];
};

/** `GET /consignes` — vue transverse (§7.7), pagination par curseur. `reessayer` : RF-115,
 *  `admin` porte `[]` sur tout le domaine Pièces (`matrice-droits.ts`), même raison que
 *  `useListeArticles`. */
export function useConsignes(filtres: FiltresConsignes): ResultatConsignes {
  const reessayer = useDoitReessayer();
  const { resultat, elements } = useListeCurseur<ReponseConsigneEchangeStandard>({
    cle: clesPieces.consignes.liste(filtres),
    charger: (curseur) => listerConsignes(filtres, { limite: LIMITE_PAGE, curseur }),
    reessayer,
  });

  return { ...resultat, consignes: elements };
}
