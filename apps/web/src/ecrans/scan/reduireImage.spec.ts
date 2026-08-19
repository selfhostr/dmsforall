import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErreurReductionImage, reduireImagePourEnvoi } from './reduireImage';

/**
 * jsdom (26.1) n'implémente ni le décodage réel d'`<img>` ni `HTMLCanvasElement.getContext` (ce
 * dernier renvoie toujours `null` sans polyfill `canvas`, absent de ce dépôt — voir
 * `package.json`) : chaque comportement est donc simulé explicitement ici, jamais supposé. Même
 * patron de stub que `useImprimerOr.spec.tsx` pour `URL.createObjectURL`/`revokeObjectURL`
 * (absents de jsdom).
 */

type ComportementImage = 'succes' | 'echec';

function installerImageFactice(
  comportement: ComportementImage,
  dimensions = { largeur: 3000, hauteur: 2000 },
): void {
  class ImageFactice {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_valeur: string) {
      queueMicrotask(() => {
        if (comportement === 'succes') {
          this.naturalWidth = dimensions.largeur;
          this.naturalHeight = dimensions.hauteur;
          this.onload?.();
        } else {
          this.onerror?.();
        }
      });
    }
  }
  vi.stubGlobal('Image', ImageFactice as unknown as typeof Image);
}

function installerCanvasFactice(): { drawImage: ReturnType<typeof vi.fn> } {
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
  ) {
    callback(new Blob(['jpeg-factice'], { type: 'image/jpeg' }));
  });
  return { drawImage };
}

let compteurUrl = 0;
let creerObjectUrl: ReturnType<typeof vi.fn>;
let revoquerObjectUrl: ReturnType<typeof vi.fn>;

beforeEach(() => {
  compteurUrl = 0;
  creerObjectUrl = vi.fn(() => `blob:objet-${++compteurUrl}`);
  revoquerObjectUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { value: creerObjectUrl, configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoquerObjectUrl, configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fichier(nom: string, type: string): File {
  return new File(['contenu-factice'], nom, { type });
}

describe('reduireImagePourEnvoi', () => {
  it('réduit une image décodable, réencode en JPEG, et respecte le ratio en plafonnant le plus grand côté', async () => {
    installerImageFactice('succes', { largeur: 3840, hauteur: 2160 });
    installerCanvasFactice();

    const resultat = await reduireImagePourEnvoi(fichier('permis.jpg', 'image/jpeg'));

    // 3840x2160, ratio 16:9 — plafonné à 1920 de plus grand côté (voir `DIMENSION_MAX_PX`).
    expect(resultat.largeurPx).toBe(1920);
    expect(resultat.hauteurPx).toBe(1080);
    expect(resultat.blob.type).toBe('image/jpeg');
  });

  it('ne réduit PAS une image déjà plus petite que la dimension maximale (ratio plafonné à 1, jamais agrandi)', async () => {
    installerImageFactice('succes', { largeur: 800, hauteur: 600 });
    installerCanvasFactice();

    const resultat = await reduireImagePourEnvoi(fichier('petite.jpg', 'image/jpeg'));

    expect(resultat.largeurPx).toBe(800);
    expect(resultat.hauteurPx).toBe(600);
  });

  it('libère TOUJOURS l’URL d’objet créée pour le décodage, même en cas de succès (jamais conservée)', async () => {
    installerImageFactice('succes');
    installerCanvasFactice();

    await reduireImagePourEnvoi(fichier('permis.jpg', 'image/jpeg'));

    expect(creerObjectUrl).toHaveBeenCalledTimes(1);
    expect(revoquerObjectUrl).toHaveBeenCalledWith('blob:objet-1');
  });

  it('un fichier au nom/type HEIC qui ne se décode pas produit ErreurReductionImage("heic_non_pris_en_charge")', async () => {
    installerImageFactice('echec');

    const rejet = reduireImagePourEnvoi(fichier('IMG_1234.HEIC', 'image/heic'));

    await expect(rejet).rejects.toBeInstanceOf(ErreurReductionImage);
    await expect(rejet).rejects.toMatchObject({ motif: 'heic_non_pris_en_charge' });
  });

  it('un fichier ordinaire qui ne se décode pas produit ErreurReductionImage("echec_lecture"), pas le motif HEIC', async () => {
    installerImageFactice('echec');

    const rejet = reduireImagePourEnvoi(fichier('photo.jpg', 'image/jpeg'));

    await expect(rejet).rejects.toMatchObject({ motif: 'echec_lecture' });
  });

  it('libère l’URL d’objet même quand le décodage échoue (jamais de fuite d’URL sur l’échec)', async () => {
    installerImageFactice('echec');

    await reduireImagePourEnvoi(fichier('photo.jpg', 'image/jpeg')).catch(() => undefined);

    expect(revoquerObjectUrl).toHaveBeenCalledWith('blob:objet-1');
  });

  it('avec une zone de recadrage, réduit depuis les dimensions DE LA ZONE (pas de l’image entière) et dessine le bon rectangle source', async () => {
    installerImageFactice('succes', { largeur: 4000, hauteur: 3000 });
    const { drawImage } = installerCanvasFactice();

    const resultat = await reduireImagePourEnvoi(fichier('permis.jpg', 'image/jpeg'), {
      x: 100,
      y: 200,
      largeur: 1800,
      hauteur: 900,
    });

    // Zone 1800x900, déjà sous DIMENSION_MAX_PX (1920) sur son plus grand côté : aucune réduction
    // supplémentaire — la sortie a EXACTEMENT les dimensions de la zone, pas celles de l'image
    // entière (4000x3000, qui aurait été réduite à 1920x1440 sans recadrage).
    expect(resultat.largeurPx).toBe(1800);
    expect(resultat.hauteurPx).toBe(900);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 100, 200, 1800, 900, 0, 0, 1800, 900);
  });

  it('une zone de recadrage plus grande que DIMENSION_MAX_PX est réduite comme l’image entière l’aurait été, mais depuis SES propres dimensions', async () => {
    installerImageFactice('succes', { largeur: 4000, hauteur: 3000 });
    installerCanvasFactice();

    const resultat = await reduireImagePourEnvoi(fichier('permis.jpg', 'image/jpeg'), {
      x: 0,
      y: 0,
      largeur: 3840,
      hauteur: 2160,
    });

    expect(resultat.largeurPx).toBe(1920);
    expect(resultat.hauteurPx).toBe(1080);
  });

  it('sans polyfill canvas (jsdom réel, getContext non mocké) : échec explicite, jamais un succès silencieux', async () => {
    // AUCUN `installerCanvasFactice()` ici — comportement RÉEL de ce dépôt sous jsdom (constaté :
    // `HTMLCanvasElement.prototype.getContext` renvoie `null`), preuve que le code ne suppose
    // jamais un contexte 2D disponible.
    installerImageFactice('succes');

    const rejet = reduireImagePourEnvoi(fichier('permis.jpg', 'image/jpeg'));

    await expect(rejet).rejects.toBeInstanceOf(ErreurReductionImage);
    await expect(rejet).rejects.toMatchObject({ motif: 'echec_lecture' });
  });
});
