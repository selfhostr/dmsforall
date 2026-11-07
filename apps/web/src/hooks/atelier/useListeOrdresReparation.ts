import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { OrdreReparationResumeListe, PageCurseur } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import {
  listerResumesOrdresReparation,
  type FiltresListeOrdresReparation,
} from './ordres-reparation.api';

const LIMITE_PAGE = 50;

export type ResultatListeOrdresReparation = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<OrdreReparationResumeListe>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement
   *  (même contrat que `useListeVehicules`). */
  readonly ordres: readonly OrdreReparationResumeListe[];
};

/** `GET /ordres-reparation`, pagination par curseur (`BoutonChargerPlus`, jamais de numéro de
 *  page — voir contrat `PageCurseur`).
 *
 * CORRECTIF issue #46 : `vendeur` n'a pas `atelier.or.lire` (`matrice-droits.ts`, `LECTURE_OR`) —
 * un 403 est un refus STABLE, jamais résolu par un réessai. Sans `reessayer: useDoitReessayer()`,
 * TanStack Query rejouait la requête jusqu'à 3 fois en délai exponentiel avant de se stabiliser sur
 * le message de refus, martelant l'API pendant ~10s pour un résultat connu d'avance — même défaut
 * mesuré, même correctif que `useListeDossiersVente` (`hooks/ventes/dossiers/`). */
export function useListeOrdresReparation(
  filtres: FiltresListeOrdresReparation,
): ResultatListeOrdresReparation {
  const reessayer = useDoitReessayer();
  const { resultat, elements } = useListeCurseur<OrdreReparationResumeListe>({
    cle: clesQuery.or.liste(filtres),
    charger: (curseur) => listerResumesOrdresReparation(filtres, { limite: LIMITE_PAGE, curseur }),
    reessayer,
  });

  return { ...resultat, ordres: elements };
}
