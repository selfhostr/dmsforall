/**
 * Conversions francs <-> centimes pour les champs de saisie. Les montants sont toujours des
 * entiers (centimes) côté données ; ces fonctions ne font jamais transiter la valeur par un
 * flottant intermédiaire — parsing entier sur la chaîne de caractères uniquement.
 *
 * L'affichage (avec séparateur de milliers) est séparé : voir `lib/formats.ts#formaterMontant`.
 */

// Une seule virgule/point décimal, au plus 2 décimales. Les apostrophes (séparateur de milliers
// suisse, ex. "1'234.50") sont retirées avant le test. Le signe négatif n'est volontairement pas
// accepté ici : un montant saisi est toujours positif, un avoir se signale par son contexte
// documentaire (type de document), jamais par un nombre négatif tapé au clavier.
const MOTIF_MONTANT = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * Saisie utilisateur (francs, séparateur `,` ou `.`, apostrophes de milliers tolérées) -> centimes
 * (integer), ou `null` si la saisie n'est pas un montant valide.
 *
 * Exemples : `'1234,50'` -> `123450` · `"1'234.50"` -> `123450` · `'12.345'` -> `null` (3
 * décimales) · `'-5'` -> `null` (signe non accepté).
 */
export function francsVersCentimes(saisieBrute: string): number | null {
  const saisie = saisieBrute.trim();
  if (saisie === '') {
    return null;
  }

  const sansSeparateurMilliers = saisie.replace(/'/g, '');
  const correspondance = MOTIF_MONTANT.exec(sansSeparateurMilliers);
  if (!correspondance) {
    return null;
  }

  const [, partieEntiere, partieDecimaleBrute] = correspondance;
  const partieDecimale = (partieDecimaleBrute ?? '').padEnd(2, '0');

  // Les deux opérandes sont des entiers (chaînes de chiffres) : Number() ne fait ici que du
  // parsing entier, jamais de division ni de flottant intermédiaire.
  const centimes = Number(partieEntiere) * 100 + Number(partieDecimale);
  return Number.isSafeInteger(centimes) ? centimes : null;
}

/** Centimes (integer) -> saisie éditable en francs, point décimal, sans séparateur de milliers
 *  (ex. `123450` -> `'1234.50'`). Pour l'affichage suisse formaté, voir `formaterMontant`. */
export function centimesVersSaisie(centimes: number): string {
  if (!Number.isInteger(centimes)) {
    throw new TypeError(`centimesVersSaisie attend un entier (centimes), reçu : ${centimes}`);
  }
  const signe = centimes < 0 ? '-' : '';
  const valeurAbsolue = Math.abs(centimes);
  const partieEntiere = Math.trunc(valeurAbsolue / 100);
  const partieDecimale = valeurAbsolue % 100;
  return `${signe}${partieEntiere}.${partieDecimale.toString().padStart(2, '0')}`;
}
