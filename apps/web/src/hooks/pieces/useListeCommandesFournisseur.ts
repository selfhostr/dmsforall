import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type {
  FiltresCommandesFournisseur,
  PageCurseur,
  ReponseCommandeFournisseur,
} from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import { listerCommandesFournisseur } from './commandes-fournisseur.api';

const LIMITE_PAGE = 50;

export type ResultatListeCommandesFournisseur = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseCommandeFournisseur>[] },
  unknown
> & {
  readonly commandes: readonly ReponseCommandeFournisseur[];
};

/** `GET /commandes-fournisseur` (RP-26 → RP-31), pagination par curseur — même architecture que
 *  `useListeArticles`, y compris `reessayer` (RF-115 : `admin` porte `[]` sur tout le domaine
 *  Pièces). */
export function useListeCommandesFournisseur(
  filtres: FiltresCommandesFournisseur,
): ResultatListeCommandesFournisseur {
  const reessayer = useDoitReessayer();
  const { resultat, elements } = useListeCurseur<ReponseCommandeFournisseur>({
    cle: clesPieces.commandesFournisseur.liste(filtres),
    charger: (curseur) => listerCommandesFournisseur(filtres, { limite: LIMITE_PAGE, curseur }),
    reessayer,
  });

  return { ...resultat, commandes: elements };
}
