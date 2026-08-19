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
 * RELATIF À L'ANCRE UNIQUEMENT (`ancreBbox.x1 + MARGE_APRES_LIBELLE`) — une ancienne version de ce
 * module visait une `colonneValeurFixeFraction` (fraction ABSOLUE de page, commune à tous les
 * champs), construite sur une page suffisamment "un seul recto vertical" comme hypothèse de
 * structure. Le corpus réel (13 photos, 18.08) contredit cette hypothèse : un permis suisse se
 * photographie CARNET OUVERT, DOUBLE PAGE (page gauche = détenteur, page droite = véhicule,
 * paysage) — un libellé de la page droite (plaque/VIN/code type/date) se trouve donc vers
 * x≈0.55-0.65 DE LA PHOTO, un libellé de la page gauche (nom/adresse) vers x≈0.15-0.25. Une
 * fraction de page fixe et unique ne peut viser juste dans les deux cas à la fois — mesuré :
 * `colonneValeurFixeFraction` (0.245) plaçait la zone valeur des champs page-droite EN PLEIN DANS
 * LE BLOC DÉTENTEUR de la page gauche, zéro caractère utile capté (4 photos du corpus réel à 0
 * champ lu en repli). Le décalage RELATIF À L'ANCRE RETROUVÉE SUR CETTE PHOTO s'affranchit du
 * cadrage/zoom (photos prises à main levée, jamais deux identiquement cadrées) : seule la position
 * réellement observée compte, jamais une fraction de page devinée à l'avance.
 *
 * `etendreDroite`/`etendreBas` : la valeur suit rarement le libellé sur une seule ligne (formulaire
 * en tableau) — on prend une bande généreuse à droite ET vers le bas plutôt que de viser une boîte
 * exacte, quitte à capter le début de la colonne suivante (bleed). C'est un choix ASSUMÉ : la
 * correction se fait après coup côté API (extraction par motif + validation référentiel/checksum),
 * pas ici par un recadrage pixel-parfait impossible à garantir sur une photo de comptoir.
 *
 * `MARGE_APRES_LIBELLE` volontairement PETITE (pas un grand décalage) : chaque libellé de champ est
 * en réalité un EMPILEMENT de 3-4 lignes (fr/de/it/rm) dont l'ancre ne matche souvent qu'UNE, pas
 * forcément la plus longue — son bord droit `x1` ne dit rien de la largeur réelle de la colonne de
 * libellé imprimée (bornée par le filet vertical du tableau). Partir tôt (marge faible) risque de
 * capter la fin du libellé en plus de la valeur ; partir tard (marge large) risque de couper le
 * début de la valeur — la première erreur est récupérable en aval (regex/motif tolérant au bruit de
 * PRÉFIXE, voir `extraction-permis.ts`), la seconde ne l'est pas (caractères perdus, aucun moyen de
 * les reconstruire). Marge faible assumée pour cette raison.
 */
const MARGE_APRES_LIBELLE = 0.01;

/**
 * `hauteurFraction` CENTRÉE sur l'ancre pour les champs alignés en ligne (vin/codeType/plaque/
 * date) : l'ancre ne matche souvent qu'UNE des 3-4 lignes fr/de/it/rm empilées (parfois la
 * dernière), pas forcément la première — centrer sur SA bbox (pas aligner sur son bord haut) couvre
 * la valeur quelle que soit la ligne effectivement trouvée. `detenteurNom`/`detenteurAdresse`
 * gardent un comportement dédié : la valeur (nom, puis adresse sur 1-2 lignes) suit le libellé
 * VERS LE BAS dans la même cellule de tableau, jamais centrée dessus.
 *
 * BUG CORRIGÉ (calibrage du 18.08, corpus réel) : `boiteValeurFraction` ci-dessous branche sur
 * `geo.hauteurEstCelleDeLaLigne`, mais aucune entrée ne portait ce marqueur — la centration décrite
 * ci-dessus n'était donc JAMAIS appliquée en repli, les 4 champs en ligne retombaient tous dans la
 * branche par défaut (`y0 - hauteur * 0.15`, alignée sur le bord haut de la ligne matchée, pas
 * centrée). Sans effet sur la ligne fr (souvent la première matchée, donc déjà en haut de
 * l'empilement) mais ratait la valeur quand la ligne matchée était de/it/rm (plus bas dans
 * l'empilement) — c'est-à-dire précisément le cas que cette centration existe pour couvrir.
 */
const GEOMETRIE_VALEUR = {
  vin: { largeurFraction: 0.38, hauteurFraction: 0.065, hauteurEstCelleDeLaLigne: true },
  codeTypeCh: { largeurFraction: 0.26, hauteurFraction: 0.065, hauteurEstCelleDeLaLigne: true },
  plaque: { largeurFraction: 0.38, hauteurFraction: 0.065, hauteurEstCelleDeLaLigne: true },
  premiereMiseEnCirculationLe: {
    largeurFraction: 0.22,
    hauteurFraction: 0.065,
    hauteurEstCelleDeLaLigne: true,
  },
  // Nom : ligne unique, immédiatement au niveau du libellé matché (pas centrée : la ligne nom est
  // la PREMIÈRE de la cellule détenteur, jamais après).
  detenteurNom: { largeurFraction: 0.32, hauteurFraction: 0.05 },
  // Adresse : part du BAS du libellé matché (l'adresse suit le nom, jamais avant), bande plus haute
  // pour couvrir rue + NPA/localité sur 2 lignes.
  detenteurAdresse: { largeurFraction: 0.34, hauteurFraction: 0.11, depuisBasLibelle: true },
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

/**
 * Bbox de la zone VALEUR d'un champ, en FRACTION de page (`[0,1]`, pas en pixel) — depuis la bbox
 * de son ancre EXPRIMÉE ELLE AUSSI EN FRACTION (`normaliserBboxFraction` ci-dessous). Fonction pure,
 * résolution-indépendante par construction : l'ancre peut avoir été localisée sur une page basse
 * résolution (passe de repérage réduite, voir `pretraitement.reduireResolutionPage`) pendant que
 * la zone résultante est recadrée sur une page haute résolution différente — seule la fraction
 * traverse les deux résolutions, jamais un pixel. Le passage fraction -> pixel (sur la page cible
 * du recadrage) et l'élargissement de bord (`geometrie.elargirEtBornerBoite`) sont à la charge de
 * l'appelant (`extraction-champs.mjs`), pas de ce module qui ne connaît aucune image.
 */
export function boiteValeurFraction(champ, ancreBboxFraction) {
  const geo = GEOMETRIE_VALEUR[champ];
  const largeur = geo.largeurFraction;
  const hauteur = geo.hauteurFraction;

  // TOUJOURS relatif à l'ancre trouvée sur CETTE photo — voir le commentaire de `GEOMETRIE_VALEUR`
  // (aucune fraction de page absolue, abandonnée après mesure sur le corpus réel du 18.08).
  const left = ancreBboxFraction.x1 + MARGE_APRES_LIBELLE;

  // Vertical : CENTRÉ sur l'ancre pour les champs en ligne (vin/codeType/plaque/date) — la valeur
  // partage la même bande horizontale que le libellé, quelle que soit la ligne fr/de/it/rm
  // matchée. `depuisBasLibelle` (adresse) part du bord bas du libellé matché ; sinon (nom), du bord
  // haut avec une marge réduite (la ligne nom suit immédiatement le libellé, jamais après une
  // ligne intermédiaire).
  const top = geo.depuisBasLibelle
    ? ancreBboxFraction.y1
    : geo.hauteurEstCelleDeLaLigne
      ? (ancreBboxFraction.y0 + ancreBboxFraction.y1) / 2 - hauteur / 2
      : ancreBboxFraction.y0 - hauteur * 0.15;

  return {
    left: Math.max(0, left),
    top: Math.max(0, top),
    width: largeur,
    height: hauteur,
  };
}

/** Bbox pixel (`{x0,y0,x1,y1}`, telle que rendue par Tesseract.js) -> fraction de page. */
export function normaliserBboxFraction(bboxPixel, largeurPage, hauteurPage) {
  return {
    x0: bboxPixel.x0 / largeurPage,
    x1: bboxPixel.x1 / largeurPage,
    y0: bboxPixel.y0 / hauteurPage,
    y1: bboxPixel.y1 / hauteurPage,
  };
}

export const CHAMPS_CONNUS = Object.keys(ANCRES_PAR_CHAMP);
