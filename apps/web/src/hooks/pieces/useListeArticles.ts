import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseArticle } from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import { listerArticles, type FiltresListeArticles } from './articles.api';

const LIMITE_PAGE = 50;

export type ResultatListeArticles = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponseArticle>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — l'écran ne manipule jamais `data.pages` directement,
   *  même convention que `useListeVehicules`. */
  readonly articles: readonly ReponseArticle[];
};

/** Liste des articles du tenant (RP-03), pagination par curseur (`BoutonChargerPlus`).
 *
 *  `reessayer` : `admin` porte `[]` sur tout le domaine Pièces (RF-115, `matrice-droits.ts`) —
 *  un `403` y est donc un état RÉEL et STABLE, pas hypothétique. Sans `useDoitReessayer`, le
 *  compte technique martèle `/articles` de trois réessais exponentiels avant d'afficher le
 *  refus. */
export function useListeArticles(filtres: FiltresListeArticles): ResultatListeArticles {
  const reessayer = useDoitReessayer();
  const { resultat, elements } = useListeCurseur<ReponseArticle>({
    cle: clesPieces.articles.liste(filtres),
    charger: (curseur) => listerArticles(filtres, { limite: LIMITE_PAGE, curseur }),
    reessayer,
  });

  return { ...resultat, articles: elements };
}
