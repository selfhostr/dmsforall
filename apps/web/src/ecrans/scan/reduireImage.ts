/**
 * Réduction de la photo AVANT envoi — un garage n'a pas toujours du réseau, et une photo de
 * téléphone moderne pèse plusieurs Mo. `DIMENSION_MAX_PX` garde assez de résolution pour qu'un
 * texte imprimé de la taille d'un permis de circulation reste lisible par l'OCR après réencodage ;
 * `QUALITE_JPEG` (0.82) est un compromis courant qualité/poids pour du texte sur fond clair, pas
 * mesuré sur un vrai jeu de permis dans cet environnement (aucun accès à un appareil physique
 * dans ce contexte d'agent — voir le rapport de livraison, à vérifier en test terrain).
 *
 * `DIMENSION_MAX_PX` RELEVÉ DE 1920 À 2800 (diagnostic du 19.08.2026, chiffré) : un permis suisse
 * ouvert fait ~210mm de large, VIN/code type imprimés à ~2mm de haut ; en dessous d'~20px/caractère
 * l'OCR n'est fiable sur aucun moteur testé (mesuré sur 13 photos réelles à 1920 : VIN validé par
 * clé de contrôle 0/13). `DIMENSION_MAX_PX` s'applique à la zone déjà RECADRÉE (voir
 * `zoneRecadrage` plus bas, recadrage puis réduction en une seule passe canevas — l'ordre était déjà
 * correct avant ce changement, seule la limite était trop basse) : à 2800px sur une capture native
 * (~4032px de large côté iPhone), la zone recadrée couvre ~13px/mm au lieu de ~9px/mm à 1920 —
 * mesure honnête : les 13 photos réelles disponibles pour ce diagnostic sont déjà compressées à
 * 1280px au transfert, donc trop petites pour que ce relèvement change quoi que ce soit sur cet
 * échantillon précis (leur zone recadrée, ~1100-1260px, reste sous les DEUX limites) — le gain ne se
 * mesure que sur une capture native, non vérifié ici faute d'échantillon non compressé. Poids
 * résultant sur l'échantillon disponible : inchangé par ce relèvement (voir le rapport de
 * livraison) ; sur une capture native, poids estimé plus élevé mais non mesuré directement (pas de
 * photo native non compressée disponible pour ce diagnostic) — à confirmer en test terrain avant de
 * resserrer `QUALITE_JPEG` si le poids réel dépasse la cible (quelques centaines de Ko).
 *
 * PASSAGE PAR CANVAS = conversion de format GRATUITE au passage : `<img>` décode la source dans
 * le format que le moteur du navigateur sait lire, `canvas.toBlob('image/jpeg', ...)` réencode
 * TOUJOURS en JPEG quel que soit le format d'entrée. C'est ce qui gère le HEIC des iPhone SANS
 * bibliothèque dédiée : Safari/iOS décode le HEIC nativement (ImageIO côté OS) et cette fonction
 * réussit alors normalement ; Chromium/Firefox (desktop, Android) ne le décodent PAS et `<img>`
 * lève une erreur de chargement — traité ci-dessous comme un ÉCHEC EXPLICITE
 * (`ErreurReductionImage`), jamais une photo tronquée envoyée en silence (règle du dépôt : jamais
 * de faux succès). NON MESURÉ SUR MATÉRIEL RÉEL dans cet environnement de développement — le
 * comportement documenté ici découle des moteurs de rendu documentés publiquement, à confirmer en
 * test terrain avant mise en service (voir le rapport de livraison).
 */

const DIMENSION_MAX_PX = 2800;
const QUALITE_JPEG = 0.82;

export type MotifEchecReductionImage = 'heic_non_pris_en_charge' | 'echec_lecture';

export class ErreurReductionImage extends Error {
  readonly motif: MotifEchecReductionImage;

  constructor(motif: MotifEchecReductionImage) {
    super(`Réduction d'image impossible : ${motif}`);
    this.name = 'ErreurReductionImage';
    this.motif = motif;
  }
}

/** Heuristique de détection HEIC — ne sert QU'à choisir le message d'erreur le plus utile quand le
 *  décodage échoue (voir `motif` ci-dessus), jamais à refuser un fichier par avance : certains
 *  navigateurs le décodent très bien, refuser sur le seul type MIME punirait ceux-là pour rien. */
function ressembleAUnHeic(fichier: File): boolean {
  const type = fichier.type.toLowerCase();
  return type === 'image/heic' || type === 'image/heif' || /\.hei[cf]$/i.test(fichier.name);
}

export interface ImageReduite {
  readonly blob: Blob;
  readonly largeurPx: number;
  readonly hauteurPx: number;
}

/** Exporté pour `analyserQualitePhoto.ts` — même décodage EXACT (mêmes erreurs, même détection
 *  HEIC) que celui utilisé juste avant l'envoi, pas une variante réécrite en double. */
export async function decoderImage(fichier: File, url: string): Promise<HTMLImageElement> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('decode_echoue'));
    image.src = url;
  }).catch(() => {
    throw new ErreurReductionImage(
      ressembleAUnHeic(fichier) ? 'heic_non_pris_en_charge' : 'echec_lecture',
    );
  });
  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new ErreurReductionImage(
      ressembleAUnHeic(fichier) ? 'heic_non_pris_en_charge' : 'echec_lecture',
    );
  }
  return image;
}

/** Rectangle en pixels de l'image SOURCE décodée (jamais de la sortie réduite) — même type que
 *  `RectanglePixels` de `geometrieCadre.ts`, redéfini ici en structurel plutôt qu'importé pour ne
 *  pas coupler ce module bas niveau (réutilisable indépendamment du chantier scan) à la géométrie
 *  du cadre d'un écran précis. */
export interface ZoneRecadrage {
  readonly x: number;
  readonly y: number;
  readonly largeur: number;
  readonly hauteur: number;
}

/**
 * GARDE EXPLICITE CONTRE LA SUR-RÉDUCTION : calcule le ratio d'échelle appliqué à une zone de
 * `largeur x hauteur` pixels, JAMAIS supérieur à 1. Une zone déjà sous `DIMENSION_MAX_PX` sur son
 * plus grand côté (photo déjà petite, zone recadrée serrée, ou capture d'entrée de gamme) N'EST
 * DONC JAMAIS AGRANDIE PAR INTERPOLATION — un agrandissement n'invente aucun pixel réel, il
 * produirait un flou qui SEMBLE net à l'écran mais reste tout aussi illisible pour l'OCR qu'avant,
 * seulement plus lourd à envoyer. Dans ce cas le ratio vaut 1 : la zone est envoyée TELLE QUELLE
 * (recadrée, réencodée en JPEG, mais à sa résolution native) plutôt qu'une version « réduite »
 * qui n'aurait jamais été agrandie de toute façon mais qu'un lecteur pressé pourrait croire
 * redimensionnée pour rien. Fonction PURE, exportée pour être testée indépendamment du canevas
 * (voir `reduireImage.spec.ts`, « garde anti-sur-réduction »).
 */
export function ratioDeReduction(largeur: number, hauteur: number): number {
  return Math.min(1, DIMENSION_MAX_PX / Math.max(largeur, hauteur));
}

/**
 * Réduit `fichier` à `DIMENSION_MAX_PX` de plus grand côté et le réencode en JPEG. La photo
 * SOURCE n'est jamais conservée par cette fonction : l'URL d'objet créée pour le décodage est
 * révoquée dans tous les cas (succès ou échec), et seul le `Blob` réduit en résulte — c'est
 * l'appelant (`EcranScan.tsx`) qui garantit ensuite qu'aucun des deux ne survit au-delà de
 * l'envoi (exigence produit : « la photo n'est pas conservée »).
 *
 * `zoneRecadrage`, quand fourni (voir `geometrieCadre.ts`), restreint la source dessinée sur le
 * canevas à ce seul rectangle — le recadrage et la réduction de résolution se font donc en UNE
 * seule passe canevas, jamais un aller-retour décodage/réencodage supplémentaire. Omis (comme
 * avant ce chantier) : comportement inchangé, image entière. `DIMENSION_MAX_PX` continue de
 * plafonner le plus grand côté de la zone effectivement dessinée (recadrée ou non) — recadrer
 * D'ABORD, réduire ENSUITE (déjà le cas avant le diagnostic du 19.08.2026 : vérifié, jamais
 * inversé — voir la doc de tête), pour que la définition disponible profite au document plutôt
 * qu'au fond écarté. Le ratio lui-même vient de `ratioDeReduction` (garde anti-sur-réduction
 * explicite, voir sa doc).
 */
export async function reduireImagePourEnvoi(
  fichier: File,
  zoneRecadrage?: ZoneRecadrage,
): Promise<ImageReduite> {
  const url = URL.createObjectURL(fichier);
  try {
    const image = await decoderImage(fichier, url);

    const sourceX = zoneRecadrage?.x ?? 0;
    const sourceY = zoneRecadrage?.y ?? 0;
    const sourceLargeur = zoneRecadrage?.largeur ?? image.naturalWidth;
    const sourceHauteur = zoneRecadrage?.hauteur ?? image.naturalHeight;

    const ratio = ratioDeReduction(sourceLargeur, sourceHauteur);
    const largeurPx = Math.round(sourceLargeur * ratio);
    const hauteurPx = Math.round(sourceHauteur * ratio);

    const canvas = document.createElement('canvas');
    canvas.width = largeurPx;
    canvas.height = hauteurPx;
    const contexte = canvas.getContext('2d');
    if (!contexte) throw new ErreurReductionImage('echec_lecture');
    contexte.drawImage(
      image,
      sourceX,
      sourceY,
      sourceLargeur,
      sourceHauteur,
      0,
      0,
      largeurPx,
      hauteurPx,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITE_JPEG),
    );
    if (!blob) throw new ErreurReductionImage('echec_lecture');

    return { blob, largeurPx, hauteurPx };
  } finally {
    URL.revokeObjectURL(url);
  }
}
