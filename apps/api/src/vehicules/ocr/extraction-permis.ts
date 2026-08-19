/**
 * Extraction et validation STRUCTURELLE du texte brut rendu par le conteneur OCR
 * (`moteur-ocr-conteneur/`) — fonctions pures, aucun accès base ni réseau, donc testables sans
 * aucune image ni fixture (`extraction-permis.spec.ts`). La correspondance CONTRE la base
 * (référentiel ASTRA, véhicules, clients du tenant) vit dans `correspondance-permis.ts`, à dessein
 * séparée : ce fichier ne sait rien du tenant, ni de Postgres.
 *
 * Chaque `extraireXxx` accepte le texte brut d'UN champ (déjà recadré/OCRisé côté conteneur — voir
 * `client-moteur-ocr.ts`) et rend `null` si rien d'exploitable n'a pu en être tiré, jamais une
 * chaîne vide qui laisserait croire à une valeur lue.
 */

/** Même alphabet que la contrainte base `vehicule_vin_format_chk` (0007) — jamais un second jeu de
 *  caractères qui pourrait diverger silencieusement. I/O/Q exclus (ISO 3779 : confusion avec 1/0). */
const REGEX_VIN = /[A-HJ-NPR-Z0-9]{17}/;

const TRANSLITTERATION_VIN: Readonly<Record<string, number>> = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
  J: 1,
  K: 2,
  L: 3,
  M: 4,
  N: 5,
  P: 7,
  R: 9,
  S: 2,
  T: 3,
  U: 4,
  V: 5,
  W: 6,
  X: 7,
  Y: 8,
  Z: 9,
};

/** ISO 3779, positions 1-17 (la position 9, le caractère de contrôle lui-même, a un poids nul). */
const POIDS_VIN = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

function valeurCaractereVin(caractere: string): number | null {
  if (caractere >= '0' && caractere <= '9') return Number(caractere);
  return TRANSLITTERATION_VIN[caractere] ?? null;
}

/**
 * Clé de contrôle ISO 3779 (9ᵉ caractère). Élimine « la plupart des confusions de caractères »
 * (consigne de tâche) — mais n'est pas une garantie universelle : certains constructeurs hors
 * périmètre NHTSA n'appliquent pas cette règle à la lettre. Un VIN dont la clé ne concorde pas
 * reste donc rendu (`lu_incertain`), jamais rejeté silencieusement.
 */
export function checksumVinValide(vin: string): boolean {
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return false;
  let somme = 0;
  for (let i = 0; i < 17; i++) {
    const valeur = valeurCaractereVin(vin[i]!);
    if (valeur === null) return false;
    somme += valeur * POIDS_VIN[i]!;
  }
  const reste = somme % 11;
  const attendu = reste === 10 ? 'X' : String(reste);
  return vin[8] === attendu;
}

export interface VinExtrait {
  readonly valeur: string;
  readonly checksumValide: boolean;
}

/** Cherche 17 caractères consécutifs de l'alphabet VIN dans le texte brut (espaces/tirets du
 *  document ignorés — le permis suisse imprime le VIN en groupes de 3, ex. `WVW ZZZ 9NZ…`). */
export function extraireVin(texteBrut: string): VinExtrait | null {
  const nettoye = texteBrut.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const trouve = nettoye.match(REGEX_VIN);
  if (!trouve) return null;
  const valeur = trouve[0];
  return { valeur, checksumValide: checksumVinValide(valeur) };
}

/**
 * Candidats de code type ASTRA, du plus probable au moins probable — la correspondance contre
 * `type_approbation_ch` (`correspondance-permis.ts`) essaie chacun DANS CET ORDRE et s'arrête au
 * premier trouvé. Gère le bruit de bord de recadrage (ex. `1VD455 33SN` au lieu de `1VD455` —
 * mesuré sur l'échantillon réel : la marge généreuse du recadrage côté conteneur capte le début de
 * la colonne "Poids total" voisine, voir `moteur-ocr-conteneur/ancres.mjs`) SANS avoir à deviner
 * une largeur de recadrage parfaite, impossible à garantir sur une photo de comptoir. Tolère
 * jusqu'à 4 caractères de bruit en fin de chaîne (mesure réelle : jusqu'à 4 caractères captés en
 * plus de la colonne voisine sur l'échantillon réel — voir le rapport de livraison).
 */
export function candidatsCodeType(texteBrut: string): readonly string[] {
  const nettoye = texteBrut.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (nettoye.length < 4) return [];

  const candidats = new Set<string>([nettoye]);
  // Bruit en fin de chaîne (colonne voisine captée par la marge du recadrage) : jusqu'à 4
  // caractères de trop.
  for (let coupe = 1; coupe <= 4 && nettoye.length - coupe >= 4; coupe++) {
    candidats.add(nettoye.slice(0, -coupe));
  }
  // Bruit en début de chaîne (libellé fr/de/it/rm empilé capté avant la valeur — même cause que le
  // bruit de fin, voir ci-dessus ; mesuré sur le corpus réel jusqu'à 4 caractères de trop, pas
  // seulement 1) : jusqu'à 4 caractères retirés en tête, tant qu'il en reste au moins 4.
  for (let coupe = 1; coupe <= 4 && nettoye.length - coupe >= 4; coupe++) {
    candidats.add(nettoye.slice(coupe));
  }
  return [...candidats];
}

export interface PlaqueExtraite {
  readonly canton: string;
  readonly numero: string;
}

/** Les 26 cantons suisses (abréviation officielle à 2 lettres imprimée sur la plaque). */
const CANTONS_CH = [
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
] as const;

/** NON ancrée (mesuré sur le corpus réel : la découpe de la zone plaque, généreuse par choix
 *  assumé — voir `zones-cadrees.mjs` — capte souvent le LIBELLÉ empilé fr/de/it/rm devant la
 *  valeur ; une regex ancrée en tête de chaîne échouait alors systématiquement). Cherche le canton
 *  n'IMPORTE OÙ dans le texte nettoyé plutôt qu'en première position — restreint aux 26 abréviations
 *  cantonales réelles (pas `[A-Z]{2}` quelconque) précisément pour pouvoir se permettre de ne plus
 *  ancrer sans capter un faux positif dans le bruit de libellé environnant. */
const REGEX_PLAQUE = new RegExp(`(${CANTONS_CH.join('|')})\\s*([0-9]{1,6})`);

/** Canton (2 lettres) + numéro — la couleur imprimée à la suite (« blanc »/« vert »…) n'est pas
 *  un champ du contrat (`PlaqueLuePermis`), volontairement ignorée ici. */
export function extrairePlaque(texteBrut: string): PlaqueExtraite | null {
  const nettoye = texteBrut
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .trim();
  const trouve = nettoye.match(REGEX_PLAQUE);
  if (!trouve) return null;
  return { canton: trouve[1]!, numero: trouve[2]! };
}

const REGEX_DATE = /(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/;

/** `jj.mm.aaaa` -> ISO `aaaa-mm-jj`, avec contrôle calendaire réel (pas de `32.13.2007`) et refus
 *  d'une date dans le futur (une première mise en circulation ne peut pas être à venir). */
export function extraireDate(texteBrut: string, maintenant: Date = new Date()): string | null {
  const trouve = texteBrut.match(REGEX_DATE);
  if (!trouve) return null;
  const jour = Number(trouve[1]);
  const mois = Number(trouve[2]);
  const annee = Number(trouve[3]);
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;

  const date = new Date(Date.UTC(annee, mois - 1, jour));
  // `Date` normalise un jour hors bornes (ex. 31 février -> 3 mars) : détecter la normalisation
  // plutôt que la laisser passer pour une date valide.
  if (
    date.getUTCFullYear() !== annee ||
    date.getUTCMonth() !== mois - 1 ||
    date.getUTCDate() !== jour
  ) {
    return null;
  }
  if (date.getTime() > maintenant.getTime()) return null;

  const mm = String(mois).padStart(2, '0');
  const dd = String(jour).padStart(2, '0');
  return `${annee}-${mm}-${dd}`;
}

/** Nettoyage minimal pour un champ de texte libre (nom, ligne d'adresse) : espaces multiples
 *  réduits, bords rognés. Aucune validation structurelle — un nom/une adresse ne se « confirme »
 *  pas par un format, seulement par une correspondance trouvée en base (`correspondance-permis.ts`). */
export function nettoyerTexteLibre(texteBrut: string): string | null {
  const nettoye = texteBrut.replace(/\s+/g, ' ').trim();
  return nettoye.length > 0 ? nettoye : null;
}

/**
 * Mots-clés de raison sociale suisse (formes juridiques usuelles) — présence dans le bloc
 * détenteur => très probablement une entreprise plutôt qu'une personne physique. Best-effort :
 * une entreprise sans forme juridique dans son nom imprimé (rare, mais possible) ne sera pas
 * détectée — l'utilisateur corrige la case à cocher côté écran avant soumission, cette
 * heuristique ne fait jamais foi seule.
 */
const MOTS_CLES_RAISON_SOCIALE = [
  /\bSA\b/,
  /\bS\.A\.?\b/,
  /\bSÀRL\b/,
  /\bSARL\b/,
  /\bAG\b/,
  /\bGMBH\b/,
  /\bSAGL\b/,
  /\bSNC\b/,
  /\bCIE\b/,
  /\b&\s*CIE\b/,
];

/** `null` = aucun signal exploitable (texte absent) — distinct de `false` (texte présent, aucun
 *  mot-clé de forme juridique reconnu, présomption raisonnable de personne physique). */
export function detecterRaisonSociale(texteBrut: string | null): boolean | null {
  if (!texteBrut || texteBrut.trim().length === 0) return null;
  const majuscules = texteBrut.toUpperCase();
  return MOTS_CLES_RAISON_SOCIALE.some((motif) => motif.test(majuscules));
}

export interface NomPrenomExtrait {
  readonly nom: string;
  readonly prenom: string | null;
}

/**
 * Séparation heuristique « Nom Prénom(s) » (convention d'impression du permis suisse, champ
 * détenteur) : le PREMIER groupe de mots est pris pour le nom de famille, le reste pour le(s)
 * prénom(s). NON VALIDÉE sur un cas à plusieurs noms de famille composés (rare mais existant en
 * Suisse) — voir le rapport de livraison. Toujours présentée comme `douteuse` côté service, jamais
 * `sure` : aucune confirmation structurelle possible sur un nom propre.
 */
export function extraireNomEtPrenom(texteBrut: string | null): NomPrenomExtrait | null {
  const nettoye = texteBrut ? nettoyerTexteLibre(texteBrut) : null;
  if (!nettoye) return null;
  const mots = nettoye.split(' ');
  const nom = mots[0]!;
  const prenom = mots.length > 1 ? mots.slice(1).join(' ') : null;
  return { nom, prenom };
}

export interface AdresseExtraite {
  readonly rue: string | null;
  readonly npa: string | null;
  readonly localite: string | null;
}

const REGEX_NPA_CH = /\b(\d{4})\b\s*(.*)/;

/**
 * Bloc adresse OCRisé en un seul passage multi-lignes (`PSM.SINGLE_BLOCK`, voir le conteneur) :
 * la première ligne porteuse de contenu est prise pour la rue, la première ligne qui commence par
 * un NPA suisse (4 chiffres) donne NPA + localité. Best-effort : un bloc qui ne suit pas ce
 * patron rend `{ rue: null, npa: null, localite: null }`, jamais une valeur devinée.
 */
export function extraireAdresse(texteBrut: string): AdresseExtraite {
  const lignes = texteBrut
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);

  let rue: string | null = null;
  let npa: string | null = null;
  let localite: string | null = null;

  for (const ligne of lignes) {
    const matchNpa = ligne.match(REGEX_NPA_CH);
    if (matchNpa && !npa) {
      npa = matchNpa[1]!;
      localite = matchNpa[2]!.trim() || null;
      continue;
    }
    if (!rue) {
      rue = ligne;
    }
  }

  return { rue, npa, localite };
}
