import { type UseInfiniteQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponsePointage } from '@dfa/shared';

import { useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPointage } from './cles';
import { listerPointages, type FiltresListePointages } from './pointage.api';

const LIMITE_PAGE = 50;

export type ResultatListePointages = UseInfiniteQueryResult<
  { readonly pages: readonly PageCurseur<ReponsePointage>[] },
  unknown
> & {
  /** Toutes les pages chargées, aplaties — même contrat que `useListeOrdresReparation`/
   *  `useListeArticles` : l'écran ne manipule jamais `data.pages` directement. */
  readonly pointages: readonly ReponsePointage[];
};

/** `GET /pointages`, pagination par curseur. Générique : sert aussi bien la vue jour/semaine d'un
 *  technicien que la vue équipe du chef d'atelier — seul le jeu de `filtres` change. Un rôle sans
 *  vue équipe (`atelier.pointage.lire_equipe`, droit serveur non exposé) ne voit QUE ses propres
 *  pointages quel que soit `technicienId` demandé — restriction imposée côté service, jamais
 *  reproduite ici (voir l'en-tête de `pointage.api.ts`). */
export function useListePointages(
  filtres: FiltresListePointages,
  options?: { readonly enabled?: boolean },
): ResultatListePointages {
  const { resultat, elements } = useListeCurseur<ReponsePointage>({
    cle: clesPointage.liste(filtres),
    charger: (curseur) => listerPointages(filtres, { limite: LIMITE_PAGE, curseur }),
    actif: options?.enabled,
    fraicheur: 'toujours-frais',
  });

  return { ...resultat, pointages: elements };
}
