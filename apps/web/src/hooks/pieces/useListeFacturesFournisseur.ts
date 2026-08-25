import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseFactureFournisseur } from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import {
  listerFacturesFournisseur,
  type FiltresEcranFacturesFournisseur,
} from './factures-fournisseur.api';

const LIMITE_PAGE = 50;

export type ResultatListeFacturesFournisseur = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseFactureFournisseur>[] },
  unknown
> & {
  readonly factures: readonly ReponseFactureFournisseur[];
};

/** `GET /factures-fournisseur`, pagination par curseur, même architecture que
 *  `useListeCommandesFournisseur`.
 *
 *  `actif` (défaut `true`) : à poser explicitement à `false` tant que le droit de lecture n'est pas
 *  acquis (session en cours de résolution, ou rôle sans `pieces.facture_fournisseur.lire`) — même
 *  correctif que celui déjà appliqué à `EcranFicheCommandeFournisseur` (`peutLireCommandeFournisseur`
 *  posé AVANT le hook, jamais laissé partir puis rattrapé par un `403` générique). */
export function useListeFacturesFournisseur(
  filtres: FiltresEcranFacturesFournisseur,
  actif = true,
): ResultatListeFacturesFournisseur {
  const reessayer = useDoitReessayer();
  const { resultat, elements } = useListeCurseur<ReponseFactureFournisseur>({
    cle: clesPieces.facturesFournisseur.liste(filtres),
    charger: (curseur) => listerFacturesFournisseur({ ...filtres, limite: LIMITE_PAGE, curseur }),
    actif,
    reessayer,
  });

  return { ...resultat, factures: elements };
}
