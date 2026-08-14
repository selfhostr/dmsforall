import { clesQuery } from '@/api/cles';

import type { FiltresListePointages } from './pointage.api';

/**
 * Clés TanStack Query du domaine pointage — `api/cles.ts` est GELÉ depuis la vague 0
 * (plan-etape-1-frontend.md §5.1, voir l'en-tête du fichier : « personne d'autre n'y touche
 * ensuite ») et n'expose que trois clés pointage, taillées pour des besoins précis déjà anticipés :
 * `ouverts(site)` (qui est pointé maintenant, vue chef d'atelier), `technicienJour(technicienId,
 * date)` (le jour d'un technicien précis) et `anomalies(site)` (corbeille). Les écrans de ce
 * domaine ont besoin de clés supplémentaires (liste filtrée libre, détail, pointage ouvert d'UN
 * technicien) qu'il serait hors périmètre d'ajouter à ce fichier gelé partagé — même patron que
 * `hooks/pieces/cles.ts` (`clesPieces`), qui règle le même problème pour son domaine.
 *
 * Convention : réutiliser telles quelles les trois clés déjà posées par `clesQuery.pointages`
 * plutôt que de les dupliquer sous un autre nom (l'invalidation doit cibler la même entrée de
 * cache, pas une copie parallèle), et n'ajouter ICI que ce qui manque réellement.
 */
export const clesPointage = {
  /** `GET /pointages` avec un jeu de filtres arbitraire — utilisé par la vue jour/semaine et la
   *  vue équipe, qui ne correspondent à aucune des trois clés figées ci-dessus. */
  liste: (filtres: FiltresListePointages) => ['pointages', 'liste', filtres] as const,
  detail: (id: string) => ['pointages', 'detail', id] as const,
  /** Le pointage `en_cours` d'UN technicien précis (l'écran de pointage du technicien lui-même) —
   *  distinct de `clesQuery.pointages.ouverts(site)`, qui couvre TOUS les techniciens d'un site
   *  (vue chef d'atelier « qui est pointé maintenant »). */
  ouvertTechnicien: (technicienId: string) =>
    ['pointages', 'ouvertTechnicien', technicienId] as const,
  /** `GET /pointages/dernier-du-jour` — cible de reprise SERVEUR d'UN technicien précis (session
   *  personnelle OU identification PIN à la borne, voir `useDerniereCiblePointage`). Invalidée par
   *  `useDemarrerPointage`/`useArreterPointage`/`useCorrigerPointage` (`onSettled`/`onSuccess`) —
   *  toujours par cette même clé, jamais une copie parallèle. */
  derniereCible: (technicienId: string) => ['pointages', 'derniereCible', technicienId] as const,
  /** Réexport direct — un seul endroit à connaître pour les écrans de ce domaine. */
  ouvertsSite: clesQuery.pointages.ouverts,
  technicienJour: clesQuery.pointages.technicienJour,
  anomaliesSite: clesQuery.pointages.anomalies,
};
