/**
 * GÉOMÉTRIE DU CADRE DE CAPTURE — un seul calcul, pur et sans DOM, partagé par TROIS usages :
 *  1. l'overlay CSS affiché sur l'aperçu de la photo refusée (`PanneauRefusPhoto.tsx`), positionné
 *     en pourcentages (`FractionsCadre`) — un `<img>` conserve toujours le ratio naturel de la
 *     photo, donc des pourcentages sur sa boîte rendue tombent exactement sur les mêmes points que
 *     des pixels sur l'image source, sans mesure DOM ni `ResizeObserver` ;
 *  2. la zone de recadrage envoyée à `reduireImagePourEnvoi` (`RectanglePixels`, coordonnées de
 *     l'image source décodée) ;
 *  3. le contrôle de résolution (`analyserQualitePhoto.ts`) — la zone recadrée doit rester assez
 *     grande en pixels pour que l'OCR ait une chance de lire le texte.
 *
 * PROPORTIONS DU RECTO — `RATIO_CADRE` approxime le format papier du permis de circulation suisse
 * actuel (proche d'un rapport A-série, ~1:√2), tenu à l'horizontale pour la prise de vue. Valeur
 * NON VÉRIFIÉE sur un vrai permis dans cet environnement (aucun accès à un exemplaire physique ni
 * à un appareil réel — voir le rapport de livraison) : à confirmer en test terrain, même réserve
 * que `QUALITE_JPEG` dans `reduireImage.ts`. Un écart raisonnable (permis légèrement plus carré ou
 * plus allongé que prévu) ne casse rien : `PROPORTION_CADRE` laisse volontairement de la marge
 * (14 %) autour du cadre plutôt que de coller au bord, et le recadrage reste un CONFORT réseau/OCR,
 * jamais une condition bloquante — voir la doctrine « si tu ne peux pas le faire de façon fiable,
 * ne le fais pas » : mieux vaut un cadre un peu trop large qu'un document rogné.
 */

export const RATIO_CADRE = 1.42;

/** Fraction de la dimension limitante de la photo que le cadre occupe (marge de 14 % de chaque
 *  côté) — généreux par construction : mieux vaut un cadre qui tolère une main qui tremble un peu
 *  qu'un cadre qui rogne le document au moindre écart. */
export const PROPORTION_CADRE = 0.86;

export interface FractionsCadre {
  readonly xFrac: number;
  readonly yFrac: number;
  readonly largeurFrac: number;
  readonly hauteurFrac: number;
}

export interface RectanglePixels {
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
}

/**
 * Calcule, en fractions de la largeur/hauteur de la photo (donc indépendamment de sa résolution
 * réelle — seul le RAPPORT largeur/hauteur de la photo compte), le plus grand rectangle centré au
 * ratio `RATIO_CADRE` qui tient dans la photo, réduit à `PROPORTION_CADRE` de la dimension
 * limitante. Fonctionne quelle que soit l'orientation de la photo (portrait ou paysage) : le cadre
 * reste toujours à l'horizontale (`RATIO_CADRE` > 1), simplement plus petit relativement à une
 * photo portrait.
 */
export function calculerFractionsCadre(largeurImage: number, hauteurImage: number): FractionsCadre {
  const ratioImage = largeurImage / hauteurImage;

  let largeurFrac: number;
  let hauteurFrac: number;
  if (ratioImage >= RATIO_CADRE) {
    // Photo au moins aussi large que le cadre relativement à sa hauteur : la hauteur limite.
    hauteurFrac = PROPORTION_CADRE;
    largeurFrac = (PROPORTION_CADRE * RATIO_CADRE) / ratioImage;
  } else {
    // Photo plus « debout » que le cadre : la largeur limite.
    largeurFrac = PROPORTION_CADRE;
    hauteurFrac = (PROPORTION_CADRE * ratioImage) / RATIO_CADRE;
  }

  return {
    xFrac: (1 - largeurFrac) / 2,
    yFrac: (1 - hauteurFrac) / 2,
    largeurFrac,
    hauteurFrac,
  };
}

/** Convertit des fractions en pixels source — séparé de `calculerFractionsCadre` pour que
 *  l'overlay CSS (qui a besoin des fractions, jamais de pixels) et le recadrage réel (qui a besoin
 *  de pixels entiers) partagent la MÊME géométrie sans la recalculer deux fois avec des arrondis
 *  différents. */
export function zoneEnPixels(
  fractions: FractionsCadre,
  largeurImage: number,
  hauteurImage: number,
): RectanglePixels {
  return {
    x: Math.round(fractions.xFrac * largeurImage),
    y: Math.round(fractions.yFrac * hauteurImage),
    largeur: Math.round(fractions.largeurFrac * largeurImage),
    hauteur: Math.round(fractions.hauteurFrac * hauteurImage),
  };
}

/** Raccourci pour les appelants qui n'ont besoin que du rectangle en pixels (tests, usages hors
 *  overlay). `analyserQualitePhoto.ts` calcule les fractions une seule fois et appelle
 *  `zoneEnPixels` lui-même — voir sa doc de tête. */
export function calculerZoneCadre(largeurImage: number, hauteurImage: number): RectanglePixels {
  return zoneEnPixels(
    calculerFractionsCadre(largeurImage, hauteurImage),
    largeurImage,
    hauteurImage,
  );
}
