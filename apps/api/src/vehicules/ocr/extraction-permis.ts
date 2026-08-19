/**
 * Extraction et validation STRUCTURELLE du texte brut rendu par le conteneur OCR
 * (`moteur-rapidocr-conteneur/`) — fonctions pures, aucun accès base ni réseau, donc testables sans
 * aucune image ni fixture (`extraction-permis.spec.ts`). La correspondance CONTRE la base
 * (référentiel ASTRA, véhicules, clients du tenant) vit dans `correspondance-permis.ts`, à dessein
 * séparée : ce fichier ne sait rien du tenant, ni de Postgres.
 *
 * Chaque `extraireXxx` accepte le texte brut d'UN champ (déjà recadré/OCRisé côté conteneur — voir
 * `client-moteur-ocr.ts`) et rend `null` si rien d'exploitable n'a pu en être tiré, jamais une
 * chaîne vide qui laisserait croire à une valeur lue.
 */
import { filtrerParCoherenceWmi } from './wmi-marques';

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

// -------------------------------------------------------------------------------------------
// Recherche contrainte sur le VIN — le bruit réel est au niveau du CARACTÈRE (0/O, 1/I, 5/S…),
// pas de la bordure de recadrage : `extraireVin` ci-dessus ne rattrape rien de ce bruit-là (une
// seule fenêtre, aucune substitution). `rechercherVin` (fin de section) le fait, EN NE RENDANT
// JAMAIS un candidat corrigé s'il n'est pas le SEUL à valider la clé de contrôle — voir sa
// documentation.
// -------------------------------------------------------------------------------------------

/**
 * Ensembles de confusion visuelle retenus (consigne de tâche) — chaque sous-ensemble filtré à
 * l'alphabet VIN valide (I/O/Q exclus, ISO 3779) donne les alternatives PLAUSIBLES d'un caractère
 * lu : `0` → {0, D} (O et Q exclus), `O` (lu, donc forcément une erreur puisque hors alphabet) →
 * {0, D} aussi, etc. Volontairement RESTREINT à ces six paires — pas une distance de frappe
 * clavier ni une matrice de confusion OCR entraînée, seulement les confusions visuelles listées
 * dans la tâche.
 */
const CLASSES_CONFUSION_VIN: readonly (readonly string[])[] = [
  ['0', 'O', 'D', 'Q'],
  ['1', 'I', 'L'],
  ['5', 'S'],
  ['8', 'B'],
  ['2', 'Z'],
  ['6', 'G'],
];

const ALPHABET_VIN_VALIDE = new Set('ABCDEFGHJKLMNPRSTUVWXYZ0123456789'.split(''));

/** Alternatives valides pour un caractère lu — jamais vide pour un caractère de l'alphabet
 *  A-Z0-9 : au pire, `[caractere]` seul (aucune classe de confusion ne le concerne). */
function alternativesValidesVin(caractere: string): readonly string[] {
  const classe = CLASSES_CONFUSION_VIN.find((c) => c.includes(caractere));
  if (!classe) return ALPHABET_VIN_VALIDE.has(caractere) ? [caractere] : [];
  return classe.filter((c) => ALPHABET_VIN_VALIDE.has(c));
}

interface PositionVin {
  readonly index: number;
  /** >= 1 alternative toujours (sinon la position est un caractère hors alphabet ET hors classe
   *  de confusion — ne devrait jamais arriver après le nettoyage `[^A-Z0-9]`, filet de sécurité). */
  readonly options: readonly string[];
  /** Le caractère LU est lui-même hors alphabet VIN (I/O/Q) : DOIT être remplacé, ce n'est pas une
   *  spéculation optionnelle — v. § budget de substitution ci-dessous. */
  readonly forcee: boolean;
}

function analyserPositionsVin(fenetre: string): readonly PositionVin[] {
  return [...fenetre].map((caractere, index) => {
    const options = alternativesValidesVin(caractere);
    return {
      index,
      options: options.length > 0 ? options : [caractere],
      forcee: !ALPHABET_VIN_VALIDE.has(caractere),
    };
  });
}

/** Produit cartésien de petites listes (chaque position forcée a 1-2 alternatives, et il y en a
 *  rarement plus de 2-3 par lecture réelle — un VIN authentique ne contient jamais I/O/Q, chaque
 *  occurrence lue en est donc bien une, mais leur NOMBRE reste faible en pratique). */
function produitCartesien(listes: readonly (readonly string[])[]): readonly (readonly string[])[] {
  return listes.reduce<readonly (readonly string[])[]>(
    (acc, options) => acc.flatMap((prefixe) => options.map((option) => [...prefixe, option])),
    [[]],
  );
}

/** Tous les sous-ensembles d'indices de taille EXACTEMENT `taille` parmi {0..n-1} — utilisé pour
 *  énumérer NIVEAU PAR NIVEAU (voir `rechercherVin` : « exactement k substitutions », jamais
 *  « jusqu'à k » d'un coup — v. § MESURE ci-dessous pour pourquoi cette distinction est cruciale). */
function combinaisonsTailleExacte(n: number, taille: number): readonly (readonly number[])[] {
  if (taille === 0) return [[]];
  if (taille > n) return [];
  const resultat: number[][] = [];
  function combiner(depart: number, courant: number[]): void {
    if (courant.length === taille) {
      resultat.push([...courant]);
      return;
    }
    for (let i = depart; i <= n - (taille - courant.length); i++) {
      courant.push(i);
      combiner(i + 1, courant);
      courant.pop();
    }
  }
  combiner(0, []);
  return resultat;
}

/**
 * Jusqu'à combien de positions par ailleurs VALIDES (pas I/O/Q) on ose faire varier
 * SIMULTANÉMENT — borne l'explosion combinatoire (consigne de tâche), mais MESURÉ à 1, PAS 3
 * (valeur initialement retenue avant simulation — v. rapport de livraison) :
 *
 * Simulation Monte-Carlo (VIN valides aléatoires, une lecture bruitée générée puis reconstruite) :
 *   - 1 substitution simultanée : 2 995 essais, 61.8 % correctement corrigés, **0 faux positif**,
 *     38.2 % correctement refusés (ambigu) ;
 *   - 2 substitutions simultanées : 446 essais, 19.5 % corrigés, **28.5 % de FAUX POSITIFS**
 *     (un VIN erroné rendu `checksumValide: true`) ;
 *   - 3 substitutions simultanées : 268 essais, 14.9 % corrigés, **45.5 % de faux positifs**.
 *
 * La clé de contrôle ISO 3779 n'offre qu'un seul chiffre de contrôle (~3.46 bits, mod 11) : au-delà
 * d'UNE substitution spéculative, le nombre de candidats énumérés dépasse ce que ce seul chiffre
 * peut arbitrer sans collision — une coïncidence de clé sur un candidat SANS RAPPORT avec la
 * lecture réelle devient plus probable qu'improbable. Élargir à 2-3 substitutions n'aide donc PAS
 * à corriger plus de lectures fiables : ça remplace des refus corrects par des VIN FAUX rendus
 * `sure` — exactement ce que le contrat de sortie interdit. D'où 1, strictement, malgré la
 * consigne de tâche qui suggérait une valeur plus haute : mesuré, pas supposé (voir rapport).
 *
 * Les positions FORCÉES (I/O/Q lus, donc hors alphabet, forcément fausses) restent, elles,
 * TOUJOURS toutes essayées — pas une spéculation, une certitude à résoudre, indépendante de ce
 * budget. Mesuré séparément : 1 680 essais, 100 % correctement corrigés, 0 faux positif (2
 * alternatives par position forcée, jamais plus dans les classes retenues).
 */
const MAX_SUBSTITUTIONS_SIMULTANEES = 1;

/** Plafond dur de candidats énumérés PAR NIVEAU PAR FENÊTRE — garde-fou mesuré (rapport de
 *  livraison) : jamais atteint en pratique aux bornes ci-dessus (C(17,3) = 680 au pire), mais une
 *  lecture pathologique ne doit jamais faire exploser le temps de réponse d'un scan comptoir. */
const MAX_CANDIDATS_VIN_PAR_NIVEAU = 20_000;

/**
 * Énumère les candidats à EXACTEMENT `niveau` substitutions optionnelles simultanées (plus, s'il y
 * en a, la résolution complète des positions FORCÉES — toujours entière, indépendante de `niveau`).
 *
 * MESURÉ, ET C'EST POURQUOI « exactement » ET PAS « jusqu'à k » (rapport de livraison) : sur un
 * VIN réel à 8 positions par ailleurs ambiguës, énumérer tout jusqu'à 3 substitutions simultanées
 * fait apparaître PLUSIEURS candidats à clé de contrôle valide par pure coïncidence arithmétique
 * (mod 11, donc ~1 chance sur 11 par candidat testé — huit positions ambiguës, des dizaines de
 * combinaisons à 2-3 substitutions, la coïncidence devient presque systématique), alors qu'une
 * SEULE substitution suffisait à retrouver le VIN correct. Chercher NIVEAU PAR NIVEAU (0, puis 1,
 * puis 2…) et s'arrêter au premier niveau qui produit au moins un candidat validé (`rechercherVin`)
 * élimine ce bruit : la coïncidence à 2-3 substitutions n'est jamais atteinte quand 1 seule
 * substitution suffisait déjà.
 */
function candidatsVinNiveau(
  fenetre: string,
  positions: readonly PositionVin[],
  niveau: number,
): ReadonlySet<string> {
  const forcees = positions.filter((p) => p.forcee);
  const optionnelles = positions.filter((p) => !p.forcee && p.options.length > 1);
  if (niveau > optionnelles.length) return new Set();

  const combosForcees = produitCartesien(forcees.map((p) => p.options));
  const combosOptionnels = combinaisonsTailleExacte(optionnelles.length, niveau);
  const resultat = new Set<string>();

  for (const choixForcees of combosForcees) {
    for (const combo of combosOptionnels) {
      if (resultat.size >= MAX_CANDIDATS_VIN_PAR_NIVEAU) return resultat;
      const caracteres = [...fenetre];
      forcees.forEach((p, i) => {
        caracteres[p.index] = choixForcees[i]!;
      });
      for (const i of combo) {
        const position = optionnelles[i]!;
        const alternative = position.options.find((o) => o !== fenetre[position.index]);
        if (alternative) caracteres[position.index] = alternative;
      }
      resultat.add(caracteres.join(''));
    }
  }
  return resultat;
}

/** Fenêtres de 17 caractères À ESSAYER dans le texte brut, alphabet VIN COMPLET y compris I/O/Q
 *  (contrairement à `REGEX_VIN`) : un `O`/`I`/`Q` lu doit rester dans la fenêtre pour pouvoir être
 *  corrigé par substitution, pas faire échouer la découpe. Une seule fenêtre si la longueur nette
 *  est déjà 17 ; sinon glisse sur le texte (bruit de bord, même cause que `candidatsCodeType`),
 *  bornée à `MAX_FENETRES_VIN` fenêtres. Rien si plus court que 17 : un caractère MANQUANT ne se
 *  devine jamais (seule une confusion, pas une absence, se corrige ici). */
const MAX_FENETRES_VIN = 10;

function fenetresVin(texteBrut: string): readonly string[] {
  const nettoye = texteBrut.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (nettoye.length < 17) return [];
  if (nettoye.length === 17) return [nettoye];

  const fenetres: string[] = [];
  for (let debut = 0; debut <= nettoye.length - 17 && fenetres.length < MAX_FENETRES_VIN; debut++) {
    fenetres.push(nettoye.slice(debut, debut + 17));
  }
  return fenetres;
}

/**
 * Recherche contrainte du VIN : essaie la lecture BRUTE d'abord (`extraireVin`, rendue telle
 * quelle si sa clé de contrôle concorde déjà — aucune substitution nécessaire) puis, seulement si
 * elle échoue, énumère les substitutions plausibles NIVEAU PAR NIVEAU (0 substitution — résout
 * seulement les positions forcées s'il y en a —, puis 1, puis 2… jusqu'à
 * `MAX_SUBSTITUTIONS_SIMULTANEES`) et s'arrête au PREMIER niveau qui produit au moins un candidat
 * dont la clé de contrôle ISO 3779 valide — v. `candidatsVinNiveau` pour la mesure qui justifie de
 * ne JAMAIS mélanger les niveaux entre eux.
 *
 * CONTRAT DE SORTIE (règle absolue, voir en-tête de tâche) : à CE niveau minimal, si PLUSIEURS
 * candidats DISTINCTS valident la clé, ne choisit PAS — rend la meilleure lecture brute,
 * `checksumValide: false` (n'essaie PAS un niveau plus large : plus de substitutions ne peut que
 * ramener PLUS de candidats, jamais réduire l'ambiguïté déjà constatée). Un VIN faux est pire
 * qu'un champ vide.
 *
 * `marqueConnue` (déduite du code type ASTRA retrouvé côté `correspondance-permis.ts`) est
 * appliquée comme un GAGE DE COHÉRENCE, pas seulement un départage — MÊME quand un SEUL candidat a
 * validé la clé : mesuré par simulation (rapport de livraison), ~25 % des lectures dont l'erreur
 * réelle dépasse une seule substitution produisent quand même, par pure coïncidence arithmétique
 * (clé mod 11), UN candidat unique dont la clé valide mais qui n'est PAS le vrai VIN. Un candidat
 * dont le WMI contredit la marque déjà connue est donc rejeté même s'il était seul — voir
 * `wmi-marques.ts` § POURQUOI UN GAGE DE COHÉRENCE.
 */
export function rechercherVin(
  texteBrut: string,
  marqueConnue: string | null = null,
): VinExtrait | null {
  const lectureBrute = extraireVin(texteBrut);
  if (lectureBrute?.checksumValide) return lectureBrute;

  const fenetres = fenetresVin(texteBrut);
  if (fenetres.length === 0) return lectureBrute;

  const positionsParFenetre = fenetres.map((fenetre) => ({
    fenetre,
    positions: analyserPositionsVin(fenetre),
  }));

  for (let niveau = 0; niveau <= MAX_SUBSTITUTIONS_SIMULTANEES; niveau++) {
    const valides = new Set<string>();
    for (const { fenetre, positions } of positionsParFenetre) {
      for (const candidat of candidatsVinNiveau(fenetre, positions, niveau)) {
        if (checksumVinValide(candidat)) valides.add(candidat);
      }
    }
    if (valides.size === 0) continue; // rien à ce niveau -> élargit d'une substitution

    const coherents = filtrerParCoherenceWmi([...valides], marqueConnue);
    if (coherents.length === 1) {
      return { valeur: coherents[0]!, checksumValide: true };
    }
    // 0 (contredit par le WMI connu) ou >= 2 (ambigu, WMI n'a pas tranché) à ce niveau : n'ÉLARGIT
    // PAS davantage (v. doc ci-dessus) — rend la meilleure lecture brute, jamais une correction non
    // sûre.
    return lectureBrute ?? { valeur: fenetres[0]!, checksumValide: false };
  }

  return lectureBrute ?? { valeur: fenetres[0]!, checksumValide: false };
}

/**
 * Candidats de code type ASTRA, du plus probable au moins probable — la correspondance contre
 * `type_approbation_ch` (`correspondance-permis.ts`) essaie chacun DANS CET ORDRE et s'arrête au
 * premier trouvé. Gère le bruit de bord de recadrage (ex. `1VD455 33SN` au lieu de `1VD455` —
 * mesuré sur l'échantillon réel : la marge généreuse du recadrage côté conteneur capte le début de
 * la colonne "Poids total" voisine, voir `moteur-rapidocr-conteneur/permis.py`) SANS avoir à deviner
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
 *  assumé — voir `zones_cadrees.py` — capte souvent le LIBELLÉ empilé fr/de/it/rm devant la
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
