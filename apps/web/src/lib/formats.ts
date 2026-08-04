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
    throw new TypeError(
      `formaterPourmille attend un entier (pour mille), reçu : ${valeurPourmille}`,
    );
  }
  const pourcentage = valeurPourmille / 10;
  return `${corrigerApostropheMilliers(FORMATEUR_POURCENTAGE.format(pourcentage))} %`;
}

/** Convertit une date ISO ou objet Date en chaîne au format suisse jj.mm.aaaa pour saisie/affichage.
 *  Utilisé par les champs de saisie de date (DateInput) pour afficher le placeholder et la valeur. */
export function dateVersFormatSuisse(date: Date | string | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  const jour = String(d.getDate()).padStart(2, '0');
  const mois = String(d.getMonth() + 1).padStart(2, '0');
  const annee = d.getFullYear();
  return `${jour}.${mois}.${annee}`;
}

/** Convertit une saisie au format suisse jj.mm.aaaa en chaîne ISO aaaa-mm-jj (pour react-hook-form).
 *  Tolère les espaces superflus ; retourne undefined si le format est invalide.
 *  Valide aussi que la date existe réellement (ex: rejet de 31.02.2026). */
export function formatSuisseVersISO(valeur: string | undefined): string | undefined {
  if (!valeur || !valeur.trim()) return undefined;

  // Tolère les espacements, extrait jj, mm, aaaa
  const trimmed = valeur.trim();
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match || !match[1] || !match[2] || !match[3]) return undefined;

  const jour = parseInt(match[1], 10);
  const mois = parseInt(match[2], 10);
  const annee = parseInt(match[3], 10);

  // Valide que la date existe réellement
  const d = new Date(annee, mois - 1, jour);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) {
    return undefined; // ex: 31.02.2026 échoue
  }

  // Retourne au format ISO aaaa-mm-jj
  const moisISO = String(mois).padStart(2, '0');
  const jourISO = String(jour).padStart(2, '0');
  return `${annee}-${moisISO}-${jourISO}`;
}

/** Valide qu'une saisie est déjà une date ISO (aaaa-mm-jj) structurellement correcte ET
 *  réellement existante (même garde que `formatSuisseVersISO` : rejet de 2026-02-31). Utilisé par
 *  `DateInput` (`components/ui/date-input.tsx`) pour accepter, dans le même champ texte affiché en
 *  suisse, une valeur ISO collée ou déposée par le remplissage automatique du navigateur — sans
 *  ce second chemin de parsing, coller "2026-08-04" dans un champ qui n'affiche que du suisse
 *  serait rejeté comme invalide alors que la donnée est parfaitement exploitable. */
export function isoDirectValide(valeur: string): string | undefined {
  const trimmed = valeur.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !match[1] || !match[2] || !match[3]) return undefined;

  const annee = parseInt(match[1], 10);
  const mois = parseInt(match[2], 10);
  const jour = parseInt(match[3], 10);

  const d = new Date(annee, mois - 1, jour);
  if (d.getFullYear() !== annee || d.getMonth() !== mois - 1 || d.getDate() !== jour) {
    return undefined; // ex: 2026-02-31 échoue
  }

  return trimmed;
}
