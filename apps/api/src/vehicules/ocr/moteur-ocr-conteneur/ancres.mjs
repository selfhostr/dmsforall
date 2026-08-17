// Localisation des champs par leurs LIBELLÉS imprimés plutôt que par une position fixe dans la
// photo. Le permis de circulation suisse harmonisé porte des libellés fixes en 4 langues
// (fr/de/it/rm) à côté de chaque champ numéroté — ce sont des mots CONNUS D'AVANCE, bien plus
// faciles à reconnaître pour l'OCR qu'une valeur manuscrite/tapuscrite variable. Une fois le
// libellé localisé (bbox), la VALEUR se trouve à sa droite, sur la même bande verticale — la
// structure du formulaire fait le travail qu'une lecture libre ferait mal.
//
// Mesuré sur l'échantillon réel (voir rapport de livraison) : les libellés se reconnaissent avec
// une confiance Tesseract de 84 à 96 même en pleine page (résolution modeste, ~2000px de large).
// Un libellé NON localisé => le champ correspondant reste `null` côté API (statut `non_lu`),
// jamais une zone de repli devinée à l'aveugle.

/**
 * Chaque variante DOIT être normalisée (minuscules, sans accent, lettres seulement) — comparée à
 * `normaliserMot()` ci-dessous, jamais au texte brut de Tesseract.
 */
const ANCRES_PAR_CHAMP = {
  vin: ['chassisno', 'chassis', 'fahrgestellnr', 'fahrgestell', 'telaion', 'telaio', 'schassisnr'],
  codeTypeCh: [
    'typengenehmigung',
    'receptionpartype',
    'reception',
    'approvazionedeltipo',
    'approvaziundaltip',
  ],
  plaque: ['schild', 'plaque', 'targa', 'numer'],
  premiereMiseEnCirculationLe: [
    'inverkehrsetzung',
    'messeencirculation',
    'entradaincirculaziun',
    'circulation',
  ],
  detenteurNom: ['vornamen', 'prenoms', 'prenomi', 'prenumssecialas'],
  detenteurAdresse: ['wohnort', 'domicile', 'domicilio', 'domicil'],
};

/**
 * Géométrie de la zone VALEUR relative à la bbox du libellé trouvé, en FRACTION de la largeur/
 * hauteur de la page prétraitée (pas en pixels — indépendant de la résolution d'upscale choisie).
 *
 * `etendreDroite`/`etendreBas` : la valeur suit rarement le libellé sur une seule ligne (formulaire
 * en tableau) — on prend une bande généreuse à droite ET vers le bas plutôt que de viser une boîte
 * exacte, quitte à capter le début de la colonne suivante (bleed). C'est un choix ASSUMÉ : la
 * correction se fait après coup côté API (extraction par motif + validation référentiel/checksum),
 * pas ici par un recadrage pixel-parfait impossible à garantir sur une photo de comptoir.
 *
 * `colonneValeurFixeFraction` (au lieu d'un décalage relatif à `ancreBbox.x1`), mesuré sur
 * l'échantillon réel : chaque libellé de champ est en réalité un EMPILEMENT de 3-4 lignes
 * (fr/de/it/rm, ex. « Fahrgestell-Nr. / Châssis no / Telaio n. / Schassis nr. ») — l'ancre ne
 * matche souvent qu'UNE SEULE de ces lignes, généralement la plus courte, dont la largeur ne dit
 * rien de la largeur réelle de la colonne de libellé (bornée par le filet vertical du tableau
 * imprimé). Un décalage relatif à la largeur du mot trouvé sous-estimait donc largement le début
 * de la colonne valeur (mesuré : le texte utile commençait bien plus à droite que
 * `ancreBbox.x1 + marge`). Une fraction FIXE de la largeur de page, commune à tous les champs en
 * ligne (vin/codeType/plaque/date, alignés sur la même grille de tableau), est plus robuste.
 */
const COLONNE_VALEUR_FIXE_FRACTION = 0.245;

/**
 * `hauteurFraction` (~0.055, ~155px à 2800px de hauteur de page — la hauteur mesurée de
 * l'empilement des 3-4 lignes fr/de/it/rm d'un libellé, plus marge) et CENTRÉE sur l'ancre (voir
 * `boiteValeur`) plutôt qu'alignée sur son bord haut : l'ancre ne matche souvent qu'UNE de ces
 * lignes (parfois la dernière), pas forcément la première. Mesuré sur l'échantillon réel : aligner
 * sur `ancreBbox.y0` de la ligne matchée manquait la valeur quand la ligne matchée n'était pas la
 * première de l'empilement ; une fenêtre trop haute (`~0.1` essayé d'abord) capte à l'inverse la
 * ligne du champ SUIVANT. Une fenêtre centrée, calée sur la hauteur réelle de l'empilement, couvre
 * la valeur quelle que soit la ligne effectivement trouvée sans déborder sur le champ voisin.
 */
const GEOMETRIE_VALEUR = {
  vin: {
    colonneValeurFixeFraction: COLONNE_VALEUR_FIXE_FRACTION,
    largeurFraction: 0.6,
    hauteurFraction: 0.055,
  },
  codeTypeCh: {
    colonneValeurFixeFraction: COLONNE_VALEUR_FIXE_FRACTION,
    largeurFraction: 0.45,
    hauteurFraction: 0.055,
  },
  plaque: {
    colonneValeurFixeFraction: COLONNE_VALEUR_FIXE_FRACTION,
    largeurFraction: 0.6,
    hauteurFraction: 0.055,
  },
  premiereMiseEnCirculationLe: {
    colonneValeurFixeFraction: COLONNE_VALEUR_FIXE_FRACTION,
    largeurFraction: 0.35,
    hauteurFraction: 0.055,
  },
  detenteurNom: { decalageDroiteFraction: -0.55, largeurFraction: 0.55, hauteurFraction: 0.03 },
  detenteurAdresse: {
    decalageDroiteFraction: -0.55,
    largeurFraction: 0.55,
    // Nom + rue + NPA/localité sur plusieurs lignes : bande verticale plus haute, part du BAS du
    // libellé "Wohnort/Domicile" (l'adresse suit le nom, jamais avant).
    hauteurFraction: 0.055,
    depuisBasLibelle: true,
  },
};

export function normaliserMot(texte) {
  return (texte ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

/** Aplatit la hiérarchie block > paragraph > line > word rendue par Tesseract.js v7. */
export function motsDepuisBlocs(blocks) {
  const mots = [];
  for (const bloc of blocks ?? []) {
    for (const paragraphe of bloc.paragraphs ?? []) {
      for (const ligne of paragraphe.lines ?? []) {
        for (const mot of ligne.words ?? []) {
          mots.push(mot);
        }
      }
    }
  }
  return mots;
}

/**
 * Pour chaque champ connu, cherche le PREMIER mot dont le texte normalisé contient une des
 * variantes d'ancre (ou est contenu dedans, pour un mot tronqué par la segmentation OCR) — garde
 * le meilleur (confiance la plus haute) en cas de plusieurs correspondances.
 *
 * BRANCHE « mot COURT contenu dans l'ancre » RESTREINTE À normalise.length >= 8 (mesuré sur
 * l'échantillon réel — collision trouvée) : un mot COURT comme « type » (segment isolé de
 * « Marque et type », ligne D21, 4 caractères) est un SOUS-MOT de `typengenehmigung` (ancre du
 * champ `codeTypeCh`) — cette branche matchait donc la MAUVAISE ligne du formulaire. Le seuil de 8
 * élimine cette collision sans perdre les vraies ancres (toutes les variantes de
 * `ANCRES_PAR_CHAMP` visées par cette branche font ≥ 8 caractères une fois normalisées, ex.
 * `chassisno`/`fahrgestell`) ; l'AUTRE branche (mot qui CONTIENT l'ancre en entier) n'a pas ce
 * risque et reste ouverte dès 4 caractères (ex. `plaque`, `schild`, `targa`).
 */
export function localiserAncres(mots) {
  const resultat = {};
  for (const [champ, variantes] of Object.entries(ANCRES_PAR_CHAMP)) {
    let meilleur = null;
    for (const mot of mots) {
      const normalise = normaliserMot(mot.text);
      if (normalise.length < 4) continue;
      const correspond = variantes.some(
        (v) =>
          normalise.includes(v) ||
          (v.length >= 6 && normalise.length >= 8 && v.includes(normalise)),
      );
      if (!correspond) continue;
      if (!meilleur || mot.confidence > meilleur.confidence) {
        meilleur = mot;
      }
    }
    resultat[champ] = meilleur ? { bbox: meilleur.bbox, confiance: meilleur.confidence } : null;
  }
  return resultat;
}

/** Bbox pixel de la zone à recadrer pour lire la VALEUR d'un champ, depuis la bbox de son ancre. */
export function boiteValeur(champ, ancreBbox, largeurPage, hauteurPage) {
  const geo = GEOMETRIE_VALEUR[champ];
  const largeur = geo.largeurFraction * largeurPage;
  const hauteur = geo.hauteurFraction * hauteurPage;

  // Colonne fixe (vin/codeType/plaque/date, alignés sur la même grille de tableau) : indépendant
  // de la largeur du mot d'ancre trouvé, voir le commentaire de `GEOMETRIE_VALEUR`. Sinon (nom/
  // adresse), décalage relatif à `ancreBbox.x1` — comportement d'origine, ces deux champs n'ont
  // pas la même grille en colonnes que les champs numérotés en ligne.
  const left =
    geo.colonneValeurFixeFraction !== undefined
      ? geo.colonneValeurFixeFraction * largeurPage
      : ancreBbox.x1 + geo.decalageDroiteFraction * largeurPage;

  // Vertical : CENTRÉ sur l'ancre pour les champs à colonne fixe (voir le commentaire de
  // `GEOMETRIE_VALEUR`) ; comportement d'origine (depuis le haut, ou depuis le bas du libellé)
  // pour nom/adresse, dont la valeur suit réellement une position fixe par rapport au libellé.
  const top =
    geo.colonneValeurFixeFraction !== undefined
      ? (ancreBbox.y0 + ancreBbox.y1) / 2 - hauteur / 2
      : (geo.depuisBasLibelle ? ancreBbox.y1 : ancreBbox.y0) - hauteur * 0.15;

  return {
    left: Math.min(Math.max(0, left), largeurPage - 10),
    top: Math.min(Math.max(0, top), hauteurPage - 10),
    width: Math.min(largeur, largeurPage - left),
    height: hauteur,
  };
}

export const CHAMPS_CONNUS = Object.keys(ANCRES_PAR_CHAMP);
