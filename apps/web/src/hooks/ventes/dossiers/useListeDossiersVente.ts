import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import type { FiltresDossiersVente, PageCurseur, ReponseDossierVente } from '@dfa/shared';

import { clesVentesDossiers } from './cles';
import { listerDossiersVente } from './dossiers-vente.api';

export type ResultatListeDossiersVente = UseInfiniteQueryResult<
  InfiniteData<PageCurseur<ReponseDossierVente>>,
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement,
   *  même convention que `useListeArticles`/`useListeOrdresReparation`. */
  readonly dossiers: readonly ReponseDossierVente[];
};

const LIMITE_PAGE = 50;

/** `GET /dossiers-vente` — pagination par curseur (`BoutonChargerPlus`). */
export function useListeDossiersVente(
  filtres: Omit<FiltresDossiersVente, 'limite' | 'curseur'>,
): ResultatListeDossiersVente {
  const filtresComplets: FiltresDossiersVente = { ...filtres, limite: LIMITE_PAGE };

  const resultat = useInfiniteQuery({
    queryKey: clesVentesDossiers.liste(filtresComplets),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerDossiersVente(filtresComplets, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
  });

  return {
    ...resultat,
    dossiers: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
