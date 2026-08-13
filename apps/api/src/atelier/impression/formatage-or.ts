/**
 * Formats suisses pour la feuille d'atelier — ré-EXPORTE le helper de date déjà établi par
 * `facturation/impression/formatage-suisse.ts` pour éviter toute seconde implémentation qui
 * pourrait diverger, et ajoute UNIQUEMENT ce que la facture n'a jamais eu besoin de formater :
 * une heure (restitution promise, horodatée) et un kilométrage.
 *
 * `formaterMontantCentimes` N'EST PLUS ré-exporté ici (issue #114) : la feuille d'atelier
 * n'affiche plus aucun prix, pour aucun rôle — voir `donnees-impression-or.ts`, tête de fichier.
 * La fonction reste disponible pour son domaine d'origine (`facturation/**`), simplement plus
 * consommée par ce module.
 *
 * Import en LECTURE SEULE d'un module `facturation/**` — autorisé, cette tâche ne modifie jamais
 * ce fichier (même doctrine que `ImpressionModule` important `FacturationModule`, voir
 * `impression-or.module.ts`).
 *
 * Même absence délibérée d'`Intl` que `formatage-suisse.ts` : non déterministe d'un environnement
 * d'exécution à l'autre, donc écarté ici aussi.
 */

export { formaterDateSuisse } from '../../facturation/impression/formatage-suisse';

import { formaterDateSuisse } from '../../facturation/impression/formatage-suisse';

/** `dateIso` : horodatage ISO complet (`"YYYY-MM-DDTHH:mm:ss.sssZ"`). `"...T15:30:00.000Z"` → `"15:30"`. */
export function formaterHeureSuisse(dateIso: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(dateIso);
  const heure = m?.[1];
  const minute = m?.[2];
  if (!heure || !minute) {
    throw new RangeError(
      `formaterHeureSuisse attend un horodatage ISO complet, reçu "${dateIso}".`,
    );
  }
  return `${heure}:${minute}`;
}

/** `"2026-08-03T15:30:00.000Z"` → `"03.08.2026 15:30"`. */
export function formaterDateHeureSuisse(dateIso: string): string {
  return `${formaterDateSuisse(dateIso)} ${formaterHeureSuisse(dateIso)}`;
}

/** `valeur` : entier de kilomètres. `84500` → `"84'500 km"` — même regroupement par milliers que
 *  `formaterMontantCentimes`, mais sur un entier sans décimale (pas un montant). */
export function formaterKilometrage(valeur: number): string {
  if (!Number.isInteger(valeur)) {
    throw new RangeError(`formaterKilometrage attend un entier, reçu ${valeur}.`);
  }
  const signe = valeur < 0 ? '-' : '';
  const str = String(Math.abs(valeur));
  const groupes: string[] = [];
  for (let i = str.length; i > 0; i -= 3) {
    groupes.unshift(str.slice(Math.max(0, i - 3), i));
  }
  return `${signe}${groupes.join("'")} km`;
}
