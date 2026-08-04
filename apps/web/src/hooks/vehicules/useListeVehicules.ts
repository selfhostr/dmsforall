import { useInfiniteQuery, type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, VehiculeResume } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { listerVehicules, type FiltresListeVehicules } from './vehicules.api';

const LIMITE_PAGE = 50;

export type ResultatListeVehicules = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<VehiculeResume>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement. */
  readonly vehicules: readonly VehiculeResume[];
};

/** Liste des véhicules du tenant, pagination par curseur (`BoutonChargerPlus`, jamais de numéro
 *  de page — voir contrat `PageCurseur`).
 *
 *  `options.enabled` (facultatif, défaut `true` — comportement inchangé si omis) : à passer
 *  `false` par l'appelant tant qu'une recherche est vide, même garde que
 *  `useVehiculesStockDisponibles` — évite une requête pour toute la première page au montage d'un
 *  sélecteur dont l'UI masque de toute façon le résultat avant saisie. */
export function useListeVehicules(
  filtres: FiltresListeVehicules,
  options?: { readonly enabled?: boolean },
): ResultatListeVehicules {
  const resultat = useInfiniteQuery({
    queryKey: clesQuery.vehicules.liste(filtres),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerVehicules(filtres, { limite: LIMITE_PAGE, curseur: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
    enabled: options?.enabled,
  });

  return {
    ...resultat,
    vehicules: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
