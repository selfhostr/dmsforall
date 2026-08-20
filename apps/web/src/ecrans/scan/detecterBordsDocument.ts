import type { FractionsCadre } from './geometrieCadre';

/**
 * DÉTECTION AUTOMATIQUE DES BORDS DU DOCUMENT — demande explicite de @laupernoe (18.08.2026) : le cadrage
 * ne doit plus être une simple proportion fixe centrée (`geometrieCadre.ts`, avant ce chantier),
 * mais une vraie lecture du contenu de la photo. Ce module reste dans les limites annoncées au
 * brief : PAS de bibliothèque de vision embarquée, PAS de correction de perspective/quadrilatère
 * (le conseil de prise de vue reste « à plat, bien éclairé » — un document tenu de travers n'est
 * PAS redressé, seulement recadré en boîte alignée sur les axes). Ce qui est fait, honnêtement :
 * une DÉTECTION DE CONTOUR PAR CONTRASTE AVEC LE FOND — algorithme classique de « scanner léger »,
 * en quatre étapes, chacune une fonction PURE testable séparément (même discipline que
 * `analyserQualitePhoto.ts`) :
 *
 *  1. `couleurMedianeDuBord` — estime la couleur du FOND (table, main, sol...) en prenant la
 *     médiane des pixels d'une fine bande sur tout le pourtour de la photo (`MARGE_BORD_FRAC`),
 *     jamais seulement les 4 coins (un coin occulté par une main ne suffit pas à fausser une
 *     médiane calculée sur toute la bande).
 *  2. `carteDistancesCouleur` — distance euclidienne RGB de chaque pixel à cette couleur de fond :
 *     un document contraste presque toujours avec ce qu'il y a dessous/autour.
 *  3. `seuilOtsu` — seuil binaire choisi automatiquement sur l'histogramme des distances (méthode
 *     d'Otsu, standard, aucune valeur écrite en dur qui dépendrait de l'éclairage de la photo).
 *  4. `plusGrandComposantConnexe` — parmi tous les pixels au-dessus du seuil (« premier plan »), le
 *     plus grand blob connexe (recherche en profondeur) est supposé être le document ; les autres
 *     (reflets, ombres, un doigt isolé) sont ignorés parce qu'ils ne sont jamais les PLUS GRANDS.
 *
 * CONFIANCE, PAS CERTITUDE — `detecterBordsDepuisPixels`/`detecterBordsDocument` renvoient `null`
 * (jamais un résultat fabriqué) dès que le résultat ne ressemble pas à un document : boîte trop
 * petite ou trop grande par rapport à la photo (`AIRE_MIN_FRAC`/`AIRE_MAX_FRAC` — un fond qui ne se
 * distingue pas assez fait déborder la boîte sur presque toute la photo), ou blob trop troué/
 * irrégulier pour être un rectangle de papier (`REMPLISSAGE_MIN` — un doigt qui mord sur le
 * document, par exemple, casse la forme). L'appelant (`analyserQualitePhoto.ts`) doit alors
 * revenir au cadre géométrique fixe (`calculerFractionsCadre`), exactement le comportement d'avant
 * ce chantier — jamais un « repli » qui prétendrait avoir détecté quelque chose.
 *
 * SEUILS CALIBRÉS SUR 13 PHOTOS RÉELLES (permis de circulation suisses, un mélange portrait/
 * paysage, tenus en main ou posés à plat, éclairage variable — fournies par @laupernoe le 18.08.2026,
 * jamais copiées dans ce dépôt). Mesuré sur cet échantillon : ~3/13 déclenchent une détection
 * confiante (le reste revient honnêtement au cadre fixe, comportement inchangé), et ZÉRO détection
 * confiante n'a rogné le document dans l'échantillon — avant le dernier ajustement de
 * `REMPLISSAGE_MIN` (0.5 -> 0.7), UNE détection confiante coupait le bord droit d'un document
 * (permis tenu en main, fond façon housing de voiture peu contrasté) : c'est ce cas précis qui a
 * fait remonter le seuil. Échantillon restreint (13 photos, un seul lot, une seule main) : à
 * recalibrer si le taux de rognage constaté en usage réel dépasse ce qui a été mesuré ici — mêmes
 * réserves que `RESOLUTION_MIN_PX`/`VARIANCE_LUMINANCE_MIN` dans `analyserQualitePhoto.ts`.
 *
 * COÛT — tout le calcul tourne sur une copie réduite à `DIMENSION_ANALYSE_PX` de plus grand côté
 * (jamais l'image pleine résolution) : ~320x240 pixels, une seule passe pour le fond, une pour les
 * distances/histogramme, une recherche en profondeur pour le composant connexe — de l'ordre de la
 * dizaine de millisecondes sur un poste de développement (mesuré via Node, voir le rapport de
 * livraison ; non mesuré sur téléphone réel dans cet environnement). Exécuté UNE SEULE FOIS par
 * photo fixe (capture ou dépôt de fichier) — jamais par image de flux vidéo, voir `CaptureLiveCadrage.tsx`
 * pour la cadence, volontairement bien plus économe, prévue pour la prise de vue en direct.
 *
 * SIGNAL BRUT FACTORISÉ (chantier « refus des photos structurellement illisibles », 20.08.2026) —
 * les étapes 1 à 4 ci-dessus, SANS les portes de confiance, sont exposées séparément
 * (`trouverPlusGrandComposantParContraste`) et la réduction DOM séparément aussi
 * (`reduireSourcePourAnalyse`) : `detecterBordsDepuisPixels`/`detecterBordsDepuisSource`
 * ci-dessous les enchaînent avec les portes de confiance (comportement inchangé, toujours couvert
 * par `detecterBordsDocument.spec.ts`), et `detecterAnomaliesCadrage.ts` les enchaîne AUTREMENT pour
 * repérer précisément les cas que ces portes rejettent (marge insuffisante, page non posée à plat) —
 * voir sa doc de tête. Un seul algorithme, deux lectures du même signal, jamais deux implémentations
 * qui pourraient diverger.
 */

export const DIMENSION_ANALYSE_PX = 320;

/** Largeur de la bande de bord échantillonnée pour estimer la couleur du fond, en fraction de la
 *  dimension de l'image réduite. NON CALIBRÉE indépendamment — voir la doc de tête. */
const MARGE_BORD_FRAC = 0.06;

/** Marge ajoutée autour de la boîte détectée avant conversion en fractions, pour ne pas rogner
 *  l'antialiasing/le flou du bord réel du document — même philosophie que `PROPORTION_CADRE` dans
 *  `geometrieCadre.ts`, en plus discret puisque la détection est déjà, par construction, plus
 *  précise qu'une proportion fixe. */
const MARGE_PADDING_FRAC = 0.02;

/** En dessous de cette fraction de l'aire totale, la boîte détectée est jugée trop petite pour être
 *  fiable (probablement du bruit — reflet, ombre, un coin de doigt) plutôt qu'un document entier. */
const AIRE_MIN_FRAC = 0.12;

/** Au-dessus de cette fraction, la boîte détectée couvre presque toute la photo : le fond ne s'est
 *  probablement pas assez distingué du document pour que la détection ait un sens (mieux vaut
 *  revenir au cadre fixe, généreux par construction, que d'affirmer avoir « détecté » le cadre
 *  entier de la photo). EXPORTÉE : `detecterAnomaliesCadrage.ts` réutilise délibérément la MÊME
 *  valeur comme porte d'entrée de son diagnostic « marge insuffisante / page non à plat » — c'est
 *  précisément la zone que cette constante fait rejeter ici qui l'intéresse, voir sa doc de tête. */
export const AIRE_MAX_FRAC = 0.9;

/** Fraction minimale de la boîte englobante effectivement occupée par le composant connexe. Un vrai
 *  document rectangulaire remplit presque toute sa boîte englobante ; un blob troué/en L (un doigt
 *  qui mord sur un coin, un reflet qui fusionne avec une ombre) s'en écarte. Relevé de 0.5 à 0.7
 *  après un cas de rognage observé sur les photos réelles — voir la doc de tête. */
const REMPLISSAGE_MIN = 0.7;

export interface TamponPixels {
  readonly largeur: number;
  readonly hauteur: number;
  /** RGBA, longueur attendue `largeur * hauteur * 4` — voir `detecterBordsDepuisPixels`, qui
   *  refuse explicitement de deviner sur un tampon de taille inattendue plutôt que de lire hors de
   *  ses bornes (`ArrayLike` renvoie `undefined`, jamais une erreur, sur un index hors limites : un
   *  bug silencieux garanti sans ce contrôle). */
  readonly data: ArrayLike<number>;
}

export interface DetectionBords {
  readonly fractions: FractionsCadre;
  /** Fraction de la boîte englobante réellement occupée par le composant détecté — voir
   *  `REMPLISSAGE_MIN`. Exposé pour le diagnostic/tests, pas utilisé par les appelants normaux. */
  readonly remplissage: number;
  /** Fraction de l'aire totale de la photo couverte par la boîte — voir `AIRE_MIN_FRAC`/
   *  `AIRE_MAX_FRAC`. Même statut que `remplissage`. */
  readonly aireFrac: number;
}

/** Médiane, canal par canal, des pixels d'une bande de largeur `MARGE_BORD_FRAC` courant tout le
 *  pourtour de l'image — fonction PURE, testable avec un tampon littéral. */
export function couleurMedianeDuBord(tampon: TamponPixels): readonly [number, number, number] {
  const { largeur, hauteur, data } = tampon;
  const margeX = Math.max(1, Math.round(largeur * MARGE_BORD_FRAC));
  const margeY = Math.max(1, Math.round(hauteur * MARGE_BORD_FRAC));
  const rouges: number[] = [];
  const verts: number[] = [];
  const bleus: number[] = [];
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const surLeBord = x < margeX || x >= largeur - margeX || y < margeY || y >= hauteur - margeY;
      if (!surLeBord) continue;
      const base = (y * largeur + x) * 4;
      rouges.push(data[base]!);
      verts.push(data[base + 1]!);
      bleus.push(data[base + 2]!);
    }
  }
  return [mediane(rouges), mediane(verts), mediane(bleus)];
}

function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  const triees = [...valeurs].sort((a, b) => a - b);
  return triees[Math.floor(triees.length / 2)]!;
}

/** Distance euclidienne RGB de chaque pixel à `fond` — un scalaire par pixel, fonction PURE. */
export function carteDistancesCouleur(
  tampon: TamponPixels,
  fond: readonly [number, number, number],
): Float64Array {
  const { largeur, hauteur, data } = tampon;
  const distances = new Float64Array(largeur * hauteur);
  for (let p = 0; p < largeur * hauteur; p += 1) {
    const base = p * 4;
    const dr = data[base]! - fond[0];
    const dv = data[base + 1]! - fond[1];
    const db = data[base + 2]! - fond[2];
    distances[p] = Math.sqrt(dr * dr + dv * dv + db * db);
  }
  return distances;
}

/** Seuil binaire optimal (méthode d'Otsu — maximise la variance INTER-classe entre les deux
 *  populations que sépare le seuil) sur un histogramme déjà construit. Fonction PURE, générique
 *  (aucune hypothèse sur ce que l'histogramme représente), même patron que `variance` dans
 *  `analyserQualitePhoto.ts`. Renvoie l'INDICE de bin, pas une valeur physique — à l'appelant de
 *  reconvertir selon l'échelle utilisée pour construire l'histogramme. */
export function seuilOtsu(histogramme: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < histogramme.length; i += 1) total += histogramme[i]!;
  if (total === 0) return 0;

  let sommeTotale = 0;
  for (let i = 0; i < histogramme.length; i += 1) sommeTotale += i * histogramme[i]!;

  let poidsArriere = 0;
  let sommeArriere = 0;
  let varianceMax = -1;
  let seuil = 0;
  for (let t = 0; t < histogramme.length; t += 1) {
    poidsArriere += histogramme[t]!;
    if (poidsArriere === 0) continue;
    const poidsAvant = total - poidsArriere;
    if (poidsAvant === 0) break;
    sommeArriere += t * histogramme[t]!;
    const moyenneArriere = sommeArriere / poidsArriere;
    const moyenneAvant = (sommeTotale - sommeArriere) / poidsAvant;
    const ecart = moyenneArriere - moyenneAvant;
    const varianceInter = poidsArriere * poidsAvant * ecart * ecart;
    if (varianceInter > varianceMax) {
      varianceMax = varianceInter;
      seuil = t;
    }
  }
  return seuil;
}

export interface ComposantConnexe {
  readonly nbPixels: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Plus grand composant connexe (4-connexité, recherche en profondeur ITÉRATIVE — jamais récursive,
 *  une grille de `DIMENSION_ANALYSE_PX` de côté dépasserait la pile d'appel par récursion) d'un
 *  masque binaire. Fonction PURE, `masque` de longueur `largeur * hauteur` (0 ou toute valeur
 *  truthy). Renvoie `null` si aucun pixel n'est à 1. */
export function plusGrandComposantConnexe(
  masque: ArrayLike<number>,
  largeur: number,
  hauteur: number,
): ComposantConnexe | null {
  const total = largeur * hauteur;
  const vus = new Uint8Array(total);
  const pile = new Int32Array(total);
  let meilleur: ComposantConnexe | null = null;

  for (let depart = 0; depart < total; depart += 1) {
    if (!masque[depart] || vus[depart]) continue;

    let sommet = 0;
    pile[sommet] = depart;
    sommet += 1;
    vus[depart] = 1;
    let nbPixels = 0;
    let minX = largeur;
    let maxX = -1;
    let minY = hauteur;
    let maxY = -1;

    while (sommet > 0) {
      sommet -= 1;
      const p = pile[sommet]!;
      const x = p % largeur;
      const y = (p - x) / largeur;
      nbPixels += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const voisins = [
        x > 0 ? p - 1 : -1,
        x < largeur - 1 ? p + 1 : -1,
        y > 0 ? p - largeur : -1,
        y < hauteur - 1 ? p + largeur : -1,
      ];
      for (const voisin of voisins) {
        if (voisin >= 0 && masque[voisin] && !vus[voisin]) {
          vus[voisin] = 1;
          pile[sommet] = voisin;
          sommet += 1;
        }
      }
    }

    if (!meilleur || nbPixels > meilleur.nbPixels) {
      meilleur = { nbPixels, minX, maxX, minY, maxY };
    }
  }

  return meilleur;
}

export interface ComposantParContraste {
  readonly composant: ComposantConnexe;
  /** Fraction de la boîte englobante réellement occupée par le composant — même définition que
   *  `DetectionBords.remplissage`, calculée AVANT toute porte de confiance. */
  readonly remplissage: number;
  /** Fraction de l'aire totale du tampon couverte par la boîte — même définition que
   *  `DetectionBords.aireFrac`, calculée AVANT toute porte de confiance. */
  readonly aireFrac: number;
}

/**
 * Étapes 1 à 4 de la doc de tête (fond -> distances -> seuil -> composant connexe), SANS AUCUNE des
 * trois portes de confiance (`AIRE_MIN_FRAC`, `AIRE_MAX_FRAC`, `REMPLISSAGE_MIN`) : le plus grand
 * composant connexe trouvé par contraste avec le fond, quelle que soit sa taille ou sa forme.
 * Factorisée pour être lue par DEUX consommateurs qui veulent des choses opposées de ce même signal
 * brut — voir la doc de tête du fichier :
 *  - `detecterBordsDepuisPixels`, juste en dessous, qui applique les portes AVANT de s'en servir
 *    comme cadrage (comportement inchangé, couvert par `detecterBordsDocument.spec.ts`) ;
 *  - `detecterAnomaliesCadrage.ts`, qui s'en sert au contraire pour repérer les cas que CES portes
 *    rejettent.
 *
 * Fonction PURE — aucun DOM, testable avec des tampons littéraux. Renvoie `null` dès que
 * `tampon.data` n'a pas la longueur attendue (`largeur * hauteur * 4` — jamais une lecture hors
 * bornes silencieuse) ou qu'aucun pixel de premier plan n'existe (photo entièrement uniforme, cas
 * dégénéré).
 */
export function trouverPlusGrandComposantParContraste(
  tampon: TamponPixels,
): ComposantParContraste | null {
  const { largeur, hauteur, data } = tampon;
  if (largeur <= 0 || hauteur <= 0) return null;
  if (data.length !== largeur * hauteur * 4) return null;

  const fond = couleurMedianeDuBord(tampon);
  const distances = carteDistancesCouleur(tampon, fond);

  let distanceMax = 0;
  for (let p = 0; p < distances.length; p += 1) {
    if (distances[p]! > distanceMax) distanceMax = distances[p]!;
  }
  if (distanceMax === 0) return null; // photo parfaitement uniforme, rien à détecter

  const NB_BINS = 256;
  const echelleBin = (NB_BINS - 1) / distanceMax;
  const bins = new Uint16Array(distances.length);
  const histogramme = new Array<number>(NB_BINS).fill(0);
  for (let p = 0; p < distances.length; p += 1) {
    const bin = Math.min(NB_BINS - 1, Math.round(distances[p]! * echelleBin));
    bins[p] = bin;
    histogramme[bin] = histogramme[bin]! + 1;
  }
  const seuilBin = seuilOtsu(histogramme);

  const masque = new Uint8Array(distances.length);
  for (let p = 0; p < distances.length; p += 1) masque[p] = bins[p]! > seuilBin ? 1 : 0;

  const composant = plusGrandComposantConnexe(masque, largeur, hauteur);
  if (!composant) return null;

  const bboxLargeur = composant.maxX - composant.minX + 1;
  const bboxHauteur = composant.maxY - composant.minY + 1;
  const remplissage = composant.nbPixels / (bboxLargeur * bboxHauteur);
  const aireFrac = (bboxLargeur * bboxHauteur) / (largeur * hauteur);

  return { composant, remplissage, aireFrac };
}

/**
 * Applique les trois portes de confiance (voir la doc de tête) au signal brut de
 * `trouverPlusGrandComposantParContraste`, puis convertit la boîte englobante en fractions avec la
 * marge de confort (`MARGE_PADDING_FRAC`). Fonction PURE, testable avec des tampons littéraux (voir
 * `detecterBordsDocument.spec.ts`). Renvoie `null` dès que le signal brut est `null` (voir sa doc) OU
 * que la boîte détectée échoue l'un des trois gardes de confiance (`AIRE_MIN_FRAC`, `AIRE_MAX_FRAC`,
 * `REMPLISSAGE_MIN`) — voir la doc de tête pour ce que chacun rejette concrètement.
 */
export function detecterBordsDepuisPixels(tampon: TamponPixels): DetectionBords | null {
  const trouve = trouverPlusGrandComposantParContraste(tampon);
  if (!trouve) return null;
  const { composant, remplissage, aireFrac } = trouve;

  if (aireFrac < AIRE_MIN_FRAC || aireFrac > AIRE_MAX_FRAC || remplissage < REMPLISSAGE_MIN) {
    return null;
  }

  const { largeur, hauteur } = tampon;
  const bboxLargeur = composant.maxX - composant.minX + 1;
  const bboxHauteur = composant.maxY - composant.minY + 1;

  const xFrac0 = composant.minX / largeur;
  const yFrac0 = composant.minY / hauteur;
  const largeurFrac0 = bboxLargeur / largeur;
  const hauteurFrac0 = bboxHauteur / hauteur;

  const xFrac = Math.max(0, xFrac0 - largeurFrac0 * MARGE_PADDING_FRAC);
  const yFrac = Math.max(0, yFrac0 - hauteurFrac0 * MARGE_PADDING_FRAC);
  const largeurFrac = Math.min(1 - xFrac, largeurFrac0 * (1 + 2 * MARGE_PADDING_FRAC));
  const hauteurFrac = Math.min(1 - yFrac, hauteurFrac0 * (1 + 2 * MARGE_PADDING_FRAC));

  return {
    fractions: { xFrac, yFrac, largeurFrac, hauteurFrac },
    remplissage,
    aireFrac,
  };
}

/**
 * Enveloppe DOM PARTAGÉE : réduit une source d'image quelconque (`source`, de dimensions
 * `largeurNaturelle x hauteurNaturelle` — une `HTMLImageElement` DÉJÀ décodée pour une photo fixe,
 * voir `decoderImage` dans `reduireImage.ts`, OU une image de flux vidéo pour la prise de vue en
 * direct, voir `CaptureLiveCadrage.tsx`) sur un petit canevas de travail (`DIMENSION_ANALYSE_PX` de
 * plus grand côté). Factorisée pour être appelée à la fois par `detecterBordsDepuisSource`
 * ci-dessous ET par `detecterAnomaliesCadrage.ts` (MÊME réduction pour les deux, jamais deux
 * implémentations qui pourraient diverger). DÉGRADATION SANS CANEVAS 2D : si `getContext('2d')`
 * échoue (même cas documenté dans `analyserQualitePhoto.ts`), renvoie `null` — jamais un tampon
 * fabriqué.
 */
export function reduireSourcePourAnalyse(
  source: CanvasImageSource,
  largeurNaturelle: number,
  hauteurNaturelle: number,
): TamponPixels | null {
  if (largeurNaturelle <= 0 || hauteurNaturelle <= 0) return null;

  const echelle = Math.min(1, DIMENSION_ANALYSE_PX / Math.max(largeurNaturelle, hauteurNaturelle));
  const largeur = Math.max(1, Math.round(largeurNaturelle * echelle));
  const hauteur = Math.max(1, Math.round(hauteurNaturelle * echelle));

  const canevas = document.createElement('canvas');
  canevas.width = largeur;
  canevas.height = hauteur;
  const contexte = canevas.getContext('2d');
  if (!contexte) return null;

  contexte.drawImage(source, 0, 0, largeur, hauteur);
  const donnees = contexte.getImageData(0, 0, largeur, hauteur);
  return { largeur, hauteur, data: donnees.data };
}

/**
 * Enveloppe DOM PARTAGÉE : `reduireSourcePourAnalyse` puis délègue à `detecterBordsDepuisPixels`.
 * MÊME algorithme, MÊME calibration pour la photo fixe et la prise de vue en direct — jamais deux
 * implémentations qui pourraient diverger. `null` si la réduction échoue (pas de canevas 2D) ou si
 * `detecterBordsDepuisPixels` renvoie `null` — l'appelant revient alors au cadre géométrique fixe
 * (photo fixe) ou au statut « recherche » (prise de vue en direct) exactement comme si aucune
 * détection n'avait été tentée.
 */
export function detecterBordsDepuisSource(
  source: CanvasImageSource,
  largeurNaturelle: number,
  hauteurNaturelle: number,
): DetectionBords | null {
  const tampon = reduireSourcePourAnalyse(source, largeurNaturelle, hauteurNaturelle);
  if (!tampon) return null;
  return detecterBordsDepuisPixels(tampon);
}

/** Cas d'usage « photo fixe » de `detecterBordsDepuisSource` — voir sa doc pour le partage avec la
 *  prise de vue en direct. */
export function detecterBordsDocument(image: HTMLImageElement): DetectionBords | null {
  return detecterBordsDepuisSource(image, image.naturalWidth, image.naturalHeight);
}
