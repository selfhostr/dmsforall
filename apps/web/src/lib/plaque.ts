/**
 * Plaques d'immatriculation suisses. **Interdit formel** : ce module ne rejoue jamais la
 * normalisation utilisée par la recherche serveur (`GET /recherche`, D-08). Le contrat §7.5
 * exige que la normalisation de recherche reste strictement serveur, car elle doit être
 * identique à celle des index d'expression PostgreSQL — deux normalisations divergentes
 * produiraient des résultats manquants indébogables. `normaliserPlaque`/`formaterPlaque` ici ne
 * servent qu'à l'affichage et à la préparation de la valeur envoyée telle quelle au serveur.
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
