import { decoderImage } from './reduireImage';
import { detecterBordsDocument } from './detecterBordsDocument';
import {
  RATIO_CADRE,
  calculerFractionsCadre,
  zoneEnPixels,
  type FractionsCadre,
  type RectanglePixels,
} from './geometrieCadre';

/**
 * CONTRÔLE AVANT ENVOI — trois vérifications RÉELLEMENT mesurables côté navigateur, sur la zone
 * finalement retenue pour le recadrage, jamais un score de qualité inventé. Brief du coordinateur :
 * « ce que tu ne peux pas mesurer honnêtement, ne le prétends pas ». Cette zone vient DÉSORMAIS
 * (demande de @laupernoe, 18.08.2026) d'une vraie DÉTECTION AUTOMATIQUE DES BORDS DU DOCUMENT
 * (`detecterBordsDocument.ts`, contraste avec le fond + composant connexe — voir sa doc de tête
 * pour ce qu'elle fait et ne fait pas, notamment l'absence de correction de perspective) quand elle
 * est CONFIANTE ; sinon repli sur le cadre géométrique fixe d'avant ce chantier
 * (`calculerFractionsCadre`, proportion centrée, aucune lecture du contenu) — jamais un « cadre
 * détecté » qui ne l'aurait pas été. `cadrageDetecte` (voir `ResultatAnalyseQualite`) distingue les
 * deux cas pour l'appelant (`EcranScan.tsx`), qui doit permettre d'ANNULER un recadrage détecté
 * (une détection peut se tromper) — jamais le cadre de repli, dont la marge généreuse (14 %, voir
 * `geometrieCadre.ts`) ne coupe jamais de contenu.
 *
 * La « couverture » ci-dessous (mesure 2) reste une PROXY par densité de contraste dans la zone
 * retenue, pas une mesure de surface occupée en % — elle vérifie que la zone contient bien QUELQUE
 * CHOSE de lisible, indépendamment de la façon dont cette zone a été obtenue.
 *
 * TROIS MESURES, TROIS SEUILS — chacun est une vraie quantité calculée, mais AUCUN seuil n'a été
 * calibré sur un vrai permis dans cet environnement (aucun accès à un exemplaire physique ni à un
 * appareil réel) : même réserve, même honnêteté que `QUALITE_JPEG`/`RATIO_CADRE`. À valider en test
 * terrain avant mise en service — voir le rapport de livraison.
 *
 *  1. RÉSOLUTION — `Math.min(zone.largeur, zone.hauteur)` en pixels SOURCE (aucun canevas
 *     nécessaire, valeur DOM directe `naturalWidth`/`naturalHeight`) : sous `RESOLUTION_MIN_PX`, le
 *     texte fin (VIN, code type) n'a statistiquement pas assez de pixels pour rester lisible après
 *     réencodage JPEG. Vérifiée EN PREMIER : les deux mesures suivantes, qui échantillonnent la
 *     zone à taille FIXE (`DIMENSION_ECHANTILLON`), perdent leur sens sur une zone déjà trop
 *     pauvre en pixels sources.
 *  2. COUVERTURE (proxy) — variance de LUMINANCE dans la zone échantillonnée : une zone
 *     quasi uniforme (table, main, mur) a une variance proche de zéro, qu'un document imprimé
 *     (texte sombre sur fond clair, plusieurs blocs de couleur) n'a normalement jamais. Sous
 *     `VARIANCE_LUMINANCE_MIN`, le message rendu est « le permis est trop petit dans le cadre »
 *     (motif `documentTropPetit`) — c'est la meilleure explication PLAUSIBLE en pratique (le cas le
 *     plus probable), pas une certitude : cette mesure ne distingue pas réellement « aucun document
 *     dans le cadre » de « document minuscule au centre d'un fond uniforme ».
 *  3. NETTETÉ — variance du LAPLACIEN (technique standard de détection de flou : plus une image
 *     est nette, plus ses transitions de contraste sont marquées, plus la variance de sa dérivée
 *     seconde est élevée). Sous `VARIANCE_LAPLACIEN_MIN`, motif `photoFloue`.
 *
 * ORDRE DE PRIORITÉ quand plusieurs échouent à la fois : résolution -> couverture -> netteté (la
 * plus fondamentale d'abord, jamais plusieurs messages à la fois — un seul motif clair, jamais un
 * empilement qui noierait le garagiste).
 *
 * DÉGRADATION SANS CANEVAS 2D : si `getContext('2d')` échoue (constaté sous jsdom sans polyfill,
 * cf. `reduireImage.ts` — improbable en navigateur réel), les mesures 2 et 3 sont SAUTÉES plutôt
 * que de bloquer tout le parcours sur une limitation d'environnement : seule la résolution (mesure
 * DOM pure, sans canevas) reste appliquée. Un contrôle en moins n'est jamais un FAUX résultat —
 * `analyserQualitePhoto` ne renvoie alors ni un refus fabriqué ni un « tout est parfait » qu'elle
 * n'a pas vérifié, seulement ce qu'elle a réellement pu observer.
 */

export type MotifRefusPhoto = 'resolutionInsuffisante' | 'documentTropPetit' | 'photoFloue';

export interface ResultatAnalyseQualite {
  readonly zone: RectanglePixels;
  readonly fractions: FractionsCadre;
  /** Absent = photo acceptée. Présent = refus, avec la raison à afficher. */
  readonly motifRefus?: MotifRefusPhoto;
  /** `true` = `zone`/`fractions` viennent d'une détection automatique CONFIANTE des bords du
   *  document (`detecterBordsDocument.ts`) — l'appelant doit alors offrir un moyen d'annuler ce
   *  recadrage (une détection peut se tromper). `false` = repli sur le cadre géométrique fixe,
   *  généreux par construction : aucune annulation nécessaire, comportement identique à avant ce
   *  chantier. */
  readonly cadrageDetecte: boolean;
}

/** Plus petit côté de la zone recadrée, en pixels SOURCE — sous ce seuil, la définition ne permet
 *  statistiquement plus de lire un VIN ou un code type. NON CALIBRÉ, voir la doc de tête. */
const RESOLUTION_MIN_PX = 900;

/** Côté (en pixels) de l'échantillon carré-ish utilisé pour les mesures 2 et 3 — fixe, pour que les
 *  seuils de variance restent comparables quelle que soit la résolution de la photo source. */
const LARGEUR_ECHANTILLON = 240;

/** Variance de luminance (0–255²) en dessous de laquelle la zone est jugée trop uniforme pour
 *  contenir un document lisible. NON CALIBRÉ, voir la doc de tête — volontairement bas pour limiter
 *  les faux refus (un document réel dépasse largement ce seuil en pratique). */
const VARIANCE_LUMINANCE_MIN = 100;

/** Variance du laplacien en dessous de laquelle la photo est jugée floue. NON CALIBRÉ. */
const VARIANCE_LAPLACIEN_MIN = 15;

/** Conversion RGB -> luminance perçue (poids standard ITU-R BT.601), une valeur par pixel. Fonction
 *  PURE, testable sans DOM : `ImageData` est un objet simple à construire dans un test. */
export function nuancesDeGris(donnees: Pick<ImageData, 'data'>): Float64Array {
  const pixels = donnees.data;
  const gris = new Float64Array(pixels.length / 4);
  for (let i = 0; i < gris.length; i += 1) {
    const base = i * 4;
    gris[i] = 0.299 * pixels[base]! + 0.587 * pixels[base + 1]! + 0.114 * pixels[base + 2]!;
  }
  return gris;
}

/** Variance d'un tableau de valeurs — fonction PURE, réutilisée pour la luminance ET pour le
 *  laplacien (même calcul statistique, deux entrées différentes). */
export function variance(valeurs: ArrayLike<number>): number {
  if (valeurs.length === 0) return 0;
  let somme = 0;
  for (let i = 0; i < valeurs.length; i += 1) somme += valeurs[i]!;
  const moyenne = somme / valeurs.length;
  let sommeCarres = 0;
  for (let i = 0; i < valeurs.length; i += 1) {
    const ecart = valeurs[i]! - moyenne;
    sommeCarres += ecart * ecart;
  }
  return sommeCarres / valeurs.length;
}

/** Applique le noyau laplacien discret standard (détection de flou par variance du laplacien) sur
 *  une grille de niveaux de gris et renvoie la variance des réponses — fonction PURE. Les pixels de
 *  bord (non convolables) sont ignorés plutôt qu'étendus artificiellement : sur un échantillon de
 *  `LARGEUR_ECHANTILLON` pixels, l'effet est négligeable. */
export function varianceLaplacien(
  gris: ArrayLike<number>,
  largeur: number,
  hauteur: number,
): number {
  if (largeur < 3 || hauteur < 3) return 0;
  const reponses = new Float64Array((largeur - 2) * (hauteur - 2));
  let indice = 0;
  for (let y = 1; y < hauteur - 1; y += 1) {
    for (let x = 1; x < largeur - 1; x += 1) {
      const centre = gris[y * largeur + x]!;
      const haut = gris[(y - 1) * largeur + x]!;
      const bas = gris[(y + 1) * largeur + x]!;
      const gauche = gris[y * largeur + x - 1]!;
      const droite = gris[y * largeur + x + 1]!;
      reponses[indice] = haut + bas + gauche + droite - 4 * centre;
      indice += 1;
    }
  }
  return variance(reponses);
}

/**
 * Décode `fichier` (mêmes erreurs que `reduireImagePourEnvoi` — HEIC illisible, photo corrompue :
 * propagées telles quelles, l'appelant les traite déjà comme un échec de lecture, voir
 * `EcranScan.tsx`), détermine la zone à recadrer (détection automatique des bords si confiante,
 * repli géométrique fixe sinon — voir la doc de tête), puis mesure ce qui est honnêtement mesurable
 * dessus. L'URL d'objet créée pour le décodage est révoquée dans tous les cas — même doctrine que
 * `reduireImagePourEnvoi`, cette fonction ne conserve rien au-delà de son propre calcul.
 *
 * DEUX PASSAGES SUR LE CONTRÔLE DE RÉSOLUTION, INTENTIONNELS :
 *  1. D'ABORD sur le cadre de REPLI (`fractionsRepli`/`zoneRepli`, calcul géométrique pur, sans
 *     canevas) — si même ce cadre généreux (14 % de marge) n'a pas assez de pixels, aucun recadrage
 *     possible ne fera mieux : refus immédiat, la détection de bords (qui a un coût, même modeste)
 *     n'est jamais tentée. Préserve un invariant du test historique (« refusée SANS même toucher au
 *     canevas ») en plus d'économiser le calcul pour un cas déjà perdu.
 *  2. ENSUITE sur la zone RÉELLEMENT retenue (détectée ou repli) — une détection confiante peut,
 *     dans de rares cas, cadrer plus serré que le repli sur une photo déjà à la limite ; ce second
 *     contrôle l'attrape plutôt que de laisser passer une zone finalement trop petite pour l'OCR.
 */
export async function analyserQualitePhoto(fichier: File): Promise<ResultatAnalyseQualite> {
  const url = URL.createObjectURL(fichier);
  try {
    const image = await decoderImage(fichier, url);

    const fractionsRepli = calculerFractionsCadre(image.naturalWidth, image.naturalHeight);
    const zoneRepli = zoneEnPixels(fractionsRepli, image.naturalWidth, image.naturalHeight);

    if (Math.min(zoneRepli.largeur, zoneRepli.hauteur) < RESOLUTION_MIN_PX) {
      return {
        zone: zoneRepli,
        fractions: fractionsRepli,
        motifRefus: 'resolutionInsuffisante',
        cadrageDetecte: false,
      };
    }

    const detection = detecterBordsDocument(image);
    const fractions = detection?.fractions ?? fractionsRepli;
    const zone = detection
      ? zoneEnPixels(fractions, image.naturalWidth, image.naturalHeight)
      : zoneRepli;
    const cadrageDetecte = detection !== null;

    if (Math.min(zone.largeur, zone.hauteur) < RESOLUTION_MIN_PX) {
      return { zone, fractions, motifRefus: 'resolutionInsuffisante', cadrageDetecte };
    }

    const largeurEchantillon = LARGEUR_ECHANTILLON;
    const hauteurEchantillon = Math.max(1, Math.round(LARGEUR_ECHANTILLON / RATIO_CADRE));

    const canvas = document.createElement('canvas');
    canvas.width = largeurEchantillon;
    canvas.height = hauteurEchantillon;
    const contexte = canvas.getContext('2d');
    // Pas de canevas 2D disponible : dégradation documentée en tête de fichier, on s'arrête au
    // seul contrôle déjà fait (résolution) plutôt que de bloquer sur une limitation
    // d'environnement ou de fabriquer un résultat non mesuré.
    if (!contexte) return { zone, fractions, cadrageDetecte };

    contexte.drawImage(
      image,
      zone.x,
      zone.y,
      zone.largeur,
      zone.hauteur,
      0,
      0,
      largeurEchantillon,
      hauteurEchantillon,
    );
    const donnees = contexte.getImageData(0, 0, largeurEchantillon, hauteurEchantillon);
    const gris = nuancesDeGris(donnees);

    if (variance(gris) < VARIANCE_LUMINANCE_MIN) {
      return { zone, fractions, motifRefus: 'documentTropPetit', cadrageDetecte };
    }

    if (varianceLaplacien(gris, largeurEchantillon, hauteurEchantillon) < VARIANCE_LAPLACIEN_MIN) {
      return { zone, fractions, motifRefus: 'photoFloue', cadrageDetecte };
    }

    return { zone, fractions, cadrageDetecte };
  } finally {
    URL.revokeObjectURL(url);
  }
}
