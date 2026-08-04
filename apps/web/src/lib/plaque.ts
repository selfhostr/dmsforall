/**
 * Plaques d'immatriculation suisses. **Interdit formel** : ce module ne rejoue jamais la
 * normalisation utilisée par la recherche serveur (`GET /recherche`, D-08). Le contrat §7.5
 * exige que la normalisation de recherche reste strictement serveur, car elle doit être
 * identique à celle des index d'expression PostgreSQL — deux normalisations divergentes
 * produiraient des résultats manquants indébogables. `normaliserPlaque`/`formaterPlaque` ici ne
 * servent qu'à l'affichage et à la préparation de la valeur envoyée telle quelle au serveur ;
 * `detecterFormeSaisie` ne sert qu'à pré-sélectionner les types de recherche et ordonner
 * l'affichage des résultats, jamais à filtrer côté client.
 */

const CANTONS_SUISSES = new Set([
  'AG',
  'AI',
  'AR',
  'BE',
  'BL',
  'BS',
  'FR',
  'GE',
  'GL',
  'GR',
  'JU',
  'LU',
  'NE',
  'NW',
  'OW',
  'SG',
  'SH',
  'SO',
  'SZ',
  'TG',
  'TI',
  'UR',
  'VD',
  'VS',
  'ZG',
  'ZH',
]);

// Espaces, tirets, apostrophes (droites et typographiques) et points sont des variantes de
// saisie sans signification, à neutraliser avant comparaison ou envoi au serveur.
const CARACTERES_A_NEUTRALISER = /[\s\-'’.]/g;

/** Neutralise casse, espaces, tirets, apostrophes et points d'une plaque saisie. Ne fait aucune
 *  hypothèse de forme (canton + numéro) : une plaque historique ou étrangère reste normalisée. */
export function normaliserPlaque(saisieBrute: string): string {
  return saisieBrute.toUpperCase().replace(CARACTERES_A_NEUTRALISER, '');
}

/** Plaque normalisée -> forme d'affichage suisse "VD 123456". Insère un espace après le code
 *  canton (2 lettres) si la valeur en commence par un ; sinon rendue telle quelle (plaque
 *  étrangère, ou fragment de recherche non résolu en plaque complète). */
export function formaterPlaque(plaqueNormalisee: string): string {
  const normalisee = normaliserPlaque(plaqueNormalisee);
  const correspondance = /^([A-Z]{2})(\d+)$/.exec(normalisee);
  if (correspondance) {
    const [, canton, numero] = correspondance;
    if (canton !== undefined && numero !== undefined && CANTONS_SUISSES.has(canton)) {
      return `${canton} ${numero}`;
    }
  }
  return normalisee;
}

export type FormeSaisie = 'plaque' | 'vin' | 'email' | 'telephone' | 'numeroOr' | 'libre';

// VIN ISO 3779 : 17 caractères alphanumériques, sans I/O/Q (confusion avec 1/0).
const CARACTERE_INTERDIT_VIN = /[IOQ]/;
const MOTIF_NUMERO_OR = /^OR[\s-]?\d/;
const MOTIF_TELEPHONE = /^\+?\d{9,13}$/;

/** Devine la nature d'une saisie libre (barre de recherche globale) pour pré-sélectionner les
 *  types de recherche côté serveur et ordonner l'affichage des résultats. Heuristique
 *  d'ergonomie uniquement — ne filtre ni ne normalise la requête envoyée au serveur. */
export function detecterFormeSaisie(saisieBrute: string): FormeSaisie {
  const saisie = saisieBrute.trim();
  if (saisie === '') {
    return 'libre';
  }
  if (saisie.includes('@')) {
    return 'email';
  }

  const majuscules = saisie.toUpperCase();
  if (MOTIF_NUMERO_OR.test(majuscules)) {
    return 'numeroOr';
  }

  const compact = normaliserPlaque(saisie);

  if (
    compact.length === 17 &&
    /^[A-Z0-9]+$/.test(compact) &&
    !CARACTERE_INTERDIT_VIN.test(compact)
  ) {
    return 'vin';
  }

  const correspondancePlaque = /^([A-Z]{2})(\d{1,6})$/.exec(compact);
  if (correspondancePlaque) {
    const [, canton] = correspondancePlaque;
    if (canton !== undefined && CANTONS_SUISSES.has(canton)) {
      return 'plaque';
    }
  }

  if (MOTIF_TELEPHONE.test(compact)) {
    return 'telephone';
  }

  return 'libre';
}
