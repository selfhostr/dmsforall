// Prétraitement image — redressement, contraste, résolution. C'est ici que se gagne la
// précision (une photo de comptoir est de travers, mal éclairée, parfois floue).
//
// TOUT EN MÉMOIRE, JAMAIS SUR DISQUE : chaque fonction ci-dessous prend un Buffer et rend un
// Buffer (ou une instance sharp non finalisée). Aucun appel `.toFile()` dans ce fichier — la
// photo d'un permis de circulation porte le nom et l'adresse du détenteur, elle ne doit jamais
// toucher le système de fichiers (décision @laupernoe, voir le rapport de livraison).

import convert from 'heic-convert';
import sharp from 'sharp';

const SIGNATURES_HEIC = [
  // ftyp box à l'offset 4, brand HEIC/HEIX/MIF1/MSF1/HEVC... — détection par contenu, jamais par
  // extension de fichier (un client peut envoyer n'importe quel nom).
  'ftypheic',
  'ftypheix',
  'ftyphevc',
  'ftypheim',
  'ftypheis',
  'ftypmif1',
  'ftypmsf1',
];

export function estHeic(buffer) {
  if (buffer.length < 12) return false;
  const marqueur = buffer.toString('ascii', 4, 12);
  return SIGNATURES_HEIC.includes(marqueur);
}

/**
 * HEIC/HEIF -> PNG (décodage pur JS, pas de dépendance native libheif — c'est ce qui permet à ce
 * conteneur de rester léger, sans chaîne de compilation C++). `heic-convert` applique déjà
 * l'orientation EXIF au décodage (vérifié en mesure sur l'échantillon réel : pixels rendus déjà
 * orientés correctement) — aucune rotation manuelle supplémentaire n'est nécessaire pour ce
 * format en sortie de cette fonction.
 */
export async function decoderHeicVersPng(buffer) {
  const png = await convert({ buffer, format: 'PNG', quality: 1 });
  return Buffer.from(png);
}

/**
 * Pipeline de prétraitement PLEINE PAGE (avant la localisation des ancres) : redressement EXIF
 * (formats qui en portent, JPEG notamment — HEIC déjà traité ci-dessus), niveaux de gris,
 * normalisation de contraste, upscale à une largeur cible qui donne à Tesseract une résolution
 * effective suffisante pour lire les LIBELLÉS de champs (pas encore les valeurs — la deuxième
 * passe, ciblée, upscale beaucoup plus fort sur une zone bien plus petite).
 */
export async function pretraiterPageComplete(buffer, { largeurCible = 2000 } = {}) {
  const image = sharp(buffer, { failOn: 'none' }).rotate(); // .rotate() sans argument = auto EXIF
  const metadonnees = await image.metadata();
  const doitAgrandir = (metadonnees.width ?? 0) < largeurCible;

  const pipeline = image
    .resize({ width: largeurCible, withoutEnlargement: !doitAgrandir, kernel: 'lanczos3' })
    .grayscale()
    .normalise();

  const tampon = await pipeline.toBuffer({ resolveWithObject: true });
  return { buffer: tampon.data, largeur: tampon.info.width, hauteur: tampon.info.height };
}

/**
 * Réduit encore la résolution d'une page DÉJÀ prétraitée (niveaux de gris/contraste déjà
 * appliqués par `pretraiterPageComplete`) — sert UNIQUEMENT la passe de repérage des libellés
 * (repli, `ancres.mjs`), jamais le recadrage de valeur : Tesseract lit un LIBELLÉ IMPRIMÉ connu
 * d'avance (pas une valeur variable), une résolution modeste suffit à le localiser (mesuré :
 * confiance de reconnaissance des libellés inchangée à 1100px de large contre 2000px sur
 * l'échantillon réel, temps de la passe pleine page divisé par ~7-8 — voir le rapport de
 * livraison). Coordonnées d'ancre trouvées ici sont ensuite exprimées en FRACTION (résolution-
 * indépendantes) avant d'être reprojetées sur la page haute résolution pour le recadrage réel
 * (voir `extraction-champs.mjs`) — jamais un recadrage depuis CETTE image basse résolution.
 */
export async function reduireResolutionPage(bufferPageComplete, { largeurCible = 1100 } = {}) {
  const tampon = await sharp(bufferPageComplete)
    .resize({ width: largeurCible, withoutEnlargement: true, kernel: 'lanczos3' })
    .toBuffer({ resolveWithObject: true });
  return { buffer: tampon.data, largeur: tampon.info.width, hauteur: tampon.info.height };
}

/**
 * Recadrage + upscale CIBLÉ d'une zone de champ, à partir de l'image PLEINE PAGE DÉJÀ prétraitée
 * (mêmes pixels que ceux où les ancres ont été localisées — pas de nouveau décodage depuis
 * l'original, les coordonnées d'ancre resteraient sinon désynchronisées).
 *
 * `seuil` (binarisation) appliqué ICI seulement, pas en pleine page : sur un timbré/tapuscrit propre
 * comme un permis suisse, la binarisation par seuil fixe donne un contraste net POUR UNE PETITE
 * ZONE recadrée (mesuré : gain de justesse net sur VIN/code type/date) mais dégraderait la lecture
 * des libellés en pleine page (fond/éclairage moins uniforme sur toute la photo).
 */
export async function recadrerChamp(bufferPageComplete, boite, { largeurCible = 1800 } = {}) {
  const { left, top, width, height } = boite;
  const recadre = sharp(bufferPageComplete).extract({
    left: Math.max(0, Math.round(left)),
    top: Math.max(0, Math.round(top)),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  });

  return recadre
    .resize({ width: largeurCible, kernel: 'lanczos3' })
    .sharpen()
    .threshold(150)
    .toBuffer();
}
