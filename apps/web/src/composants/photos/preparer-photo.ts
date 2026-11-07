import {
  DIMENSION_MAX_PHOTO_PX,
  DIMENSION_VIGNETTE_PHOTO_PX,
  LIMITE_TAILLE_PHOTO_LIGNE_OCTETS,
} from '@dfa/shared';

import { decoderImage, ErreurReductionImage } from '@/ecrans/scan/reduireImage';

const QUALITE_PHOTO = 0.8;
const QUALITE_VIGNETTE = 0.7;

export interface PhotoPreparee {
  readonly photo: Blob;
  readonly vignette: Blob | null;
}

export type MotifRefusPhoto = 'trop_lourde' | 'illisible' | 'heic';

export class ErreurPreparationPhoto extends Error {
  readonly motif: MotifRefusPhoto;
  constructor(motif: MotifRefusPhoto) {
    super(`Photo refusée : ${motif}`);
    this.name = 'ErreurPreparationPhoto';
    this.motif = motif;
  }
}

/** Plus grand côté ramené à `maxPx`, jamais agrandi (un agrandissement n'ajoute aucun détail). */
export function dimensionsReduites(
  largeur: number,
  hauteur: number,
  maxPx: number,
): { readonly largeur: number; readonly hauteur: number } {
  const ratio = Math.min(1, maxPx / Math.max(largeur, hauteur));
  return { largeur: Math.round(largeur * ratio), hauteur: Math.round(hauteur * ratio) };
}

function versJpeg(image: HTMLImageElement, maxPx: number, qualite: number): Promise<Blob | null> {
  const { largeur, hauteur } = dimensionsReduites(image.naturalWidth, image.naturalHeight, maxPx);
  const canvas = document.createElement('canvas');
  canvas.width = largeur;
  canvas.height = hauteur;
  const contexte = canvas.getContext('2d');
  if (!contexte) return Promise.resolve(null);
  contexte.drawImage(image, 0, 0, largeur, hauteur);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', qualite));
}

/**
 * Photo brute de l'appareil (souvent 4000 px et plusieurs Mo) -> JPEG de 1920 px au plus + vignette
 * de 320 px. Le passage par le canevas convertit aussi le HEIC des iPhone quand le navigateur sait
 * le lire. Le serveur ne retraite jamais l'image (aucune bibliothèque d'image côté API) : c'est
 * ici que la taille est ramenée sous le plafond de 8 Mo.
 */
export async function preparerPhoto(fichier: File): Promise<PhotoPreparee> {
  const url = URL.createObjectURL(fichier);
  try {
    const image = await decoderImage(fichier, url).catch((erreur: unknown) => {
      throw new ErreurPreparationPhoto(
        erreur instanceof ErreurReductionImage && erreur.motif === 'heic_non_pris_en_charge'
          ? 'heic'
          : 'illisible',
      );
    });
    const photo = await versJpeg(image, DIMENSION_MAX_PHOTO_PX, QUALITE_PHOTO);
    if (!photo) throw new ErreurPreparationPhoto('illisible');
    if (photo.size > LIMITE_TAILLE_PHOTO_LIGNE_OCTETS) {
      throw new ErreurPreparationPhoto('trop_lourde');
    }
    const vignette = await versJpeg(image, DIMENSION_VIGNETTE_PHOTO_PX, QUALITE_VIGNETTE);
    return { photo, vignette };
  } finally {
    URL.revokeObjectURL(url);
  }
}
