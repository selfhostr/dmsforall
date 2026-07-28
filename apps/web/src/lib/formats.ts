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

const FORMATEUR_HEURE = new Intl.DateTimeFormat('de-CH', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const FORMATEUR_ENTIER = new Intl.NumberFormat('de-CH', { maximumFractionDigits: 0 });

const FORMATEUR_POURCENTAGE = new Intl.NumberFormat('de-CH', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// Intl.NumberFormat('de-CH') rend l'apostrophe typographique U+2019 (’) comme séparateur de
// milliers ; le rendu suisse standard utilise l'apostrophe droite U+0027 ('). Sans ce
// remplacement, un test d'égalité stricte sur "1'234.50" échoue silencieusement.
const APOSTROPHE_TYPOGRAPHIQUE = /’/g;

/** Neutralise l'apostrophe typographique (U+2019) que Intl.NumberFormat('de-CH') produit comme
 *  séparateur de milliers, au profit de l'apostrophe droite (U+0027) attendue en Suisse. À
 *  appliquer sur toute sortie de Intl.NumberFormat('de-CH', ...) qui peut grouper des milliers —
 *  réutilisé par lib/temps.ts pour rester cohérent avec ce fichier plutôt que de dupliquer la regex. */
export function corrigerApostropheMilliers(valeur: string): string {
  return valeur.replace(APOSTROPHE_TYPOGRAPHIQUE, "'");
}

/** Centimes (integer) -> "1'234.50". Ne jamais passer un montant en francs flottants. */
export function formaterMontant(centimes: number): string {
  if (!Number.isInteger(centimes)) {
    throw new TypeError(`formaterMontant attend un entier (centimes), reçu : ${centimes}`);
  }
  const francs = centimes / 100;
  return corrigerApostropheMilliers(FORMATEUR_MONTANT.format(francs));
}

/** Date ISO ou objet Date -> "jj.mm.aaaa" (format suisse). */
export function formaterDate(date: Date | string): string {
  const valeur = typeof date === 'string' ? new Date(date) : date;
  return FORMATEUR_DATE.format(valeur);
}

/** Date ISO ou objet Date -> "HH:MM" (24 h, format suisse). */
export function formaterHeure(date: Date | string): string {
  const valeur = typeof date === 'string' ? new Date(date) : date;
  return FORMATEUR_HEURE.format(valeur);
}

/** Date ISO ou objet Date -> "jj.mm.aaaa HH:MM". */
export function formaterDateHeure(date: Date | string): string {
  const valeur = typeof date === 'string' ? new Date(date) : date;
  return `${formaterDate(valeur)} ${formaterHeure(valeur)}`;
}

/** Unité de distance — jamais déduite implicitement, toujours passée explicitement par
 *  l'appelant (référentiel véhicule) : un import US en miles ne doit jamais s'afficher en km. */
export type UniteDistance = 'km' | 'mi';

/** Kilométrage (integer) + unité -> "125'340 km". */
export function formaterKilometrage(valeur: number, unite: UniteDistance): string {
  if (!Number.isInteger(valeur)) {
    throw new TypeError(`formaterKilometrage attend un entier, reçu : ${valeur}`);
  }
  return `${corrigerApostropheMilliers(FORMATEUR_ENTIER.format(valeur))} ${unite}`;
}

/** Pour mille (integer, 0-1000, ex. taux TVA/rabais stockés en pourmille) -> "8.1 %". */
export function formaterPourmille(valeurPourmille: number): string {
  if (!Number.isInteger(valeurPourmille)) {
    throw new TypeError(`formaterPourmille attend un entier (pour mille), reçu : ${valeurPourmille}`);
  }
  const pourcentage = valeurPourmille / 10;
  return `${corrigerApostropheMilliers(FORMATEUR_POURCENTAGE.format(pourcentage))} %`;
}
