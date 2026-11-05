import type { EtatCapaciteJour } from './types';

/**
 * Marge en dessous de laquelle un jour passe de « disponible » à « presque complet » — le plus
 * court motif du référentiel garage est le diagnostic (30 min, voir `seed-rendez-vous-demo.ts`) :
 * en dessous de cette marge, le prochain appel ne pourrait de toute façon plus caser le motif le
 * plus court. Valeur d'écran, pas une règle métier serveur — le serveur ne calcule que trois états
 * (`non_definie`/`disponible`/`complete`, sans la nuance « presque complet »).
 */
const SEUIL_PRESQUE_COMPLET_MINUTES = 30;

/**
 * Classification PURE de la capacité d'un jour, à partir des minutes réellement occupées et de la
 * capacité journalière du site (`GET /rendez-vous/capacite`, `minutesOccupees`/`capaciteMinutes`)
 * — le point le plus délicat de cet écran (consigne produit : « un écran qui affiche "libre" alors
 * que l'atelier est plein est pire que pas d'écran »). QUATRE états, jamais trois :
 *
 * - `capaciteMinutes === null` -> `non_definie` (site sans paramétrage) : ne JAMAIS retomber sur
 *   un autre état dans ce cas, même si `minutesOccupees` vaut 0 — un chiffre sans dénominateur ne
 *   dit rien sur la place restante. Prouvé en exécution (occupation réelle non nulle, jamais rendu
 *   `0` ni `'disponible'`, voir le rapport de livraison).
 * - `minutesOccupees >= capaciteMinutes` -> `complet` (le surbooking reste un état affiché, jamais
 *   un blocage — la création elle-même n'est jamais refusée pour ce motif, RV-06).
 * - marge restante `<= SEUIL_PRESQUE_COMPLET_MINUTES` -> `presque_complet`.
 * - sinon -> `disponible`.
 */
export function classerCapaciteJour(
  minutesOccupees: number,
  capaciteMinutes: number | null,
): EtatCapaciteJour {
  if (capaciteMinutes === null) return 'non_definie';
  if (minutesOccupees >= capaciteMinutes) return 'complet';
  if (capaciteMinutes - minutesOccupees <= SEUIL_PRESQUE_COMPLET_MINUTES) return 'presque_complet';
  return 'disponible';
}

/** Minutes (entier) -> « 4h30 » / « 8h00 » — jamais des minutes brutes, illisibles au comptoir. */
export function formaterDureeCourte(minutes: number): string {
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return `${heures}h${String(reste).padStart(2, '0')}`;
}

/**
 * Marge encore libre avant d'atteindre la capacité du jour — jamais négative : un jour en
 * surbooking (`minutesOccupees > capaciteMinutes`) reste à `0`, pas un solde négatif illisible au
 * comptoir (le mot « Complet » porte déjà l'alerte, pas besoin d'un chiffre qui descend sous zéro).
 * `null` UNIQUEMENT si `capaciteMinutes` est `null` — même garde que `classerCapaciteJour` : un
 * solde sans dénominateur ne dit rien de la place restante.
 */
export function minutesRestantes(
  minutesOccupees: number,
  capaciteMinutes: number | null,
): number | null {
  if (capaciteMinutes === null) return null;
  return Math.max(0, capaciteMinutes - minutesOccupees);
}
