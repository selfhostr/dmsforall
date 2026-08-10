import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { FiltresFournisseurs, PageCurseur, ReponseFournisseur } from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import { listerFournisseurs } from './fournisseurs.api';

const LIMITE_PAGE = 50;

export type ResultatListeFournisseurs = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseFournisseur>[] },
  unknown
> & {
  readonly fournisseurs: readonly ReponseFournisseur[];
};

/** `GET /fournisseurs` (RP-26), pagination par curseur — même architecture que `useListeArticles`,
 *  y compris `reessayer` (RF-115 : `admin` porte `[]` sur tout le domaine Pièces). */
export function useListeFournisseurs(filtres: FiltresFournisseurs): ResultatListeFournisseurs {
  const reessayer = useDoitReessayer();
  const { resultat, elements } = useListeCurseur<ReponseFournisseur>({
    cle: clesPieces.fournisseurs.liste(filtres),
    charger: (curseur) => listerFournisseurs(filtres, { limite: LIMITE_PAGE, curseur }),
    reessayer,
  });

  return { ...resultat, fournisseurs: elements };
}
