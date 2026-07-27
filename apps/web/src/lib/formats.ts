/**
 * Formats suisses — TOUJOURS 'de-CH' quelle que soit la langue d'interface (FR/DE/IT) :
 * 1'234.50 et 27.07.2026 sont les formats attendus par un garagiste suisse quelle que soit
 * sa langue de travail. Ne jamais dériver ces formateurs de la langue i18n courante.
 */

const FORMATEUR_MONTANT = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const FORMATEUR_DATE = new Intl.DateTimeFormat('de-CH', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

// Intl.NumberFormat('de-CH') rend l'apostrophe typographique U+2019 (’) comme séparateur de
// milliers ; le rendu suisse standard utilise l'apostrophe droite U+0027 ('). Sans ce
// remplacement, un test d'égalité stricte sur "1'234.50" échoue silencieusement.
const APOSTROPHE_TYPOGRAPHIQUE = /’/g;

/** Centimes (integer) -> "1'234.50". Ne jamais passer un montant en francs flottants. */
export function formaterMontant(centimes: number): string {
  if (!Number.isInteger(centimes)) {
    throw new TypeError(`formaterMontant attend un entier (centimes), reçu : ${centimes}`);
  }
  const francs = centimes / 100;
  return FORMATEUR_MONTANT.format(francs).replace(APOSTROPHE_TYPOGRAPHIQUE, "'");
}

/** Date ISO ou objet Date -> "jj.mm.aaaa" (format suisse). */
export function formaterDate(date: Date | string): string {
  const valeur = typeof date === 'string' ? new Date(date) : date;
  return FORMATEUR_DATE.format(valeur);
}
