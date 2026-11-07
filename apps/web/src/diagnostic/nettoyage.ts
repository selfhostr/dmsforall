/**
 * Nettoyage des textes d'un signalement avant qu'ils quittent le poste (nLPD : un signalement
 * devient une fiche PUBLIQUE sur GitHub). Tout motif reconnu est remplacé par `[masqué]`.
 *
 * Fonctions pures. Les motifs sont volontairement larges (on préfère masquer un texte inoffensif
 * que laisser filer une plaque) mais bornés par des garde-fous qui épargnent les noms de fichiers
 * du bundle (`index-GE12345.js`) et les positions de pile (`:12:3456`).
 */

export const MARQUEUR_MASQUE = '[masqué]';
export const LONGUEUR_MAX_PILE = 2000;
export const LONGUEUR_MAX_MESSAGE = 500;

const DEBUT = String.raw`(?<![\w.])`;
const CANTONS = 'AG|AI|AR|BE|BL|BS|FR|GE|GL|GR|JU|LU|NE|NW|OW|SG|SH|SO|SZ|TG|TI|UR|VD|VS|ZG|ZH';

// Ordre significatif : les motifs les plus spécifiques passent avant les plus génériques
// (un IBAN ou un n° AVS ne doivent pas être « mangés » par le motif téléphone).
const MOTIFS: readonly RegExp[] = [
  // UUID
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  // E-mail
  /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi,
  // N° AVS 756.xxxx.xxxx.xx
  new RegExp(String.raw`${DEBUT}756[. ]?\d{4}[. ]?\d{4}[. ]?\d{2}(?!\d)`, 'g'),
  // IBAN CH / LI (21 caractères, espaces facultatifs)
  /\b(?:CH|LI)\d{2}(?: ?[0-9A-Z]{4}){4} ?[0-9A-Z]\b/g,
  // Montants « CHF 1'234.50 » ou « 1'234.50 CHF »
  /\bCHF\s?-?\d[\d'’]*(?:[.,]\d{1,2})?(?![\d'’])/g,
  /(?<![\d'’.])-?\d[\d'’]*(?:[.,]\d{1,2})?\s?CHF\b/g,
  // Nombres à apostrophe « 1'234.50 »
  /(?<![\d'’.])\d{1,3}(?:['’]\d{3})+(?:\.\d{1,2})?(?![\d'’])/g,
  // Téléphone international « +41 79 123 45 67 », « 0041 79 … »
  new RegExp(
    String.raw`${DEBUT}(?:\+|00)\d{2,3}[\s./-]?(?:\(0\))?\d{1,3}(?:[\s./-]?\d{2,4}){2,4}(?!\d)`,
    'g',
  ),
  // Téléphone suisse national « 079 123 45 67 », « 021/123.45.67 », « 0791234567 »
  new RegExp(String.raw`${DEBUT}0\d{2}[\s./-]?\d{3}[\s./-]?\d{2}[\s./-]?\d{2}(?![\d.])`, 'g'),
  // Plaque suisse « VS 12345 », « GE123456 » (hors mots et noms de fichiers : ni lettre, chiffre,
  // « - » ni « . » juste avant ou après)
  new RegExp(String.raw`(?<![\w.-])(?:${CANTONS})[ \u00a0]?\d{1,6}(?![\w-])`, 'g'),
];

/** Retire la query string et le fragment d'une URL absolue : elle peut porter une plaque, un nom.
 *  S'arrête avant `:` pour préserver la position `:ligne:colonne` d'une pile. */
const RE_URL_AVEC_QUERY = /(https?:\/\/[^\s?#"'()<>]+)[?#][^\s"'()<>:]*/g;
/** Idem pour une position de pile `fichier.js?v=abc:12:3`. */
const RE_FICHIER_AVEC_QUERY = /(\.(?:m?js|jsx|tsx?))\?[^\s):]*/g;

/** Remplace par `[masqué]` tout ce qui ressemble à une donnée personnelle ou commerciale. */
export function masquer(texte: string): string {
  let resultat = texte.replace(RE_URL_AVEC_QUERY, '$1').replace(RE_FICHIER_AVEC_QUERY, '$1');
  for (const motif of MOTIFS) {
    resultat = resultat.replace(motif, MARQUEUR_MASQUE);
  }
  return resultat;
}

/** Message d'erreur nettoyé et borné. */
export function nettoyerMessage(message: string): string {
  return masquer(message).slice(0, LONGUEUR_MAX_MESSAGE);
}

/** Pile d'appels nettoyée : noms de fichiers du bundle et lignes conservés, coupée à `max`. */
export function nettoyerPile(pile: string, max: number = LONGUEUR_MAX_PILE): string {
  return masquer(pile).slice(0, Math.max(0, max));
}
