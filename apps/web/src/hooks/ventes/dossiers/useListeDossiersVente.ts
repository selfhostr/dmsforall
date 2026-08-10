import {
  useInfiniteQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import type { FiltresDossiersVente, PageCurseur, ReponseDossierVente } from '@dfa/shared';

import { useDoitReessayer } from '@/hooks/pagination-curseur';

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

export interface OptionsListeDossiersVente {
  /** Défaut `true`. À poser à `false` quand l'appelant sait DÉJÀ (matrice de droits côté front,
   *  ex. `ecrans/ventes/dossiers/droits.ts::peutLireDossierVente`) que le rôle courant n'a pas
   *  `ventes.dossier.lire` — évite d'émettre une requête vouée à un 403 stable (défaut mesuré :
   *  un panneau « Dossiers de vente » sur la fiche client martelait le serveur en boucle pour un
   *  rôle qui n'aura jamais ce droit). */
  readonly enabled?: boolean;
}

const LIMITE_PAGE = 50;

/** `GET /dossiers-vente` — pagination par curseur (`BoutonChargerPlus`).
 *
 *  Politique de réessai : `useDoitReessayer()` (`@/hooks/pagination-curseur`), partagée avec le
 *  reste de l'application — un `403 DROIT_INSUFFISANT`/`404 RESSOURCE_INTROUVABLE` est un état
 *  STABLE (aucun réessai ne le résoudra jamais), tout le reste rejoue le défaut du `QueryClient`
 *  ambiant. Voir l'en-tête de `useDoitReessayer` pour le détail de la composition. */
export function useListeDossiersVente(
  filtres: Omit<FiltresDossiersVente, 'limite' | 'curseur'>,
  options: OptionsListeDossiersVente = {},
): ResultatListeDossiersVente {
  const filtresComplets: FiltresDossiersVente = { ...filtres, limite: LIMITE_PAGE };
  const reessayer = useDoitReessayer();

  const resultat = useInfiniteQuery({
    queryKey: clesVentesDossiers.liste(filtresComplets),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listerDossiersVente(filtresComplets, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
    enabled: options.enabled ?? true,
    retry: reessayer,
  });

  return {
    ...resultat,
    dossiers: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
