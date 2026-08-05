import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import {
  TRI_DEFAUT_SUIVI_VENTE,
  type FiltresSuiviVente,
  type LigneSuiviVente,
  type PageCurseur,
} from '@dfa/shared';

import { clesVentesSuivi } from './cles';
import { listerSuiviVente } from './suivi-vente.api';

export type ResultatListeSuiviVente = UseInfiniteQueryResult<
  InfiniteData<PageCurseur<LigneSuiviVente>>,
  unknown
> & {
  /** Toutes les pages chargées, aplaties — même convention que `useListeDossiersVente`. */
  readonly lignes: readonly LigneSuiviVente[];
};

const LIMITE_PAGE = 50;

/** `GET /ventes/suivi` — pagination par curseur (`BoutonChargerPlus`). Un seul tri exposé par le
 *  serveur (`TRIS_SUIVI_VENTE`, échéance la plus proche d'abord) : pas de paramètre `tri`
 *  configurable côté appelant, contrairement à `useListeDossiersVente`. */
export function useListeSuiviVente(
  filtres: Omit<FiltresSuiviVente, 'limite' | 'curseur' | 'tri'>,
): ResultatListeSuiviVente {
  const filtresComplets: FiltresSuiviVente = {
    ...filtres,
    limite: LIMITE_PAGE,
    tri: TRI_DEFAUT_SUIVI_VENTE,
  };

  const resultat = useInfiniteQuery({
    queryKey: clesVentesSuivi.liste(filtresComplets),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerSuiviVente(filtresComplets, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    lignes: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
