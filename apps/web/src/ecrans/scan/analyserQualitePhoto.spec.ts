import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErreurReductionImage } from './reduireImage';
import {
  analyserQualitePhoto,
  nuancesDeGris,
  variance,
  varianceLaplacien,
} from './analyserQualitePhoto';

/**
 * MÊME patron de stub `Image`/`URL.createObjectURL`/`revokeObjectURL` que `reduireImage.spec.ts`
 * (jsdom ne décode pas réellement une image). `getContext` renvoie ici un objet muni de
 * `getImageData`, en plus de `drawImage` — c'est la donnée que `getImageData` renvoie qui pilote le
 * résultat de l'analyse dans les tests « glue », pas un vrai rendu canevas.
 */

function installerImageFactice(
  comportement: 'succes' | 'echec',
  dimensions = { largeur: 3000, hauteur: 2200 },
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

/** Construit un tableau de pixels RGBA de la taille attendue par l'échantillon d'analyse
 *  (`LARGEUR_ECHANTILLON` x sa hauteur dérivée de `RATIO_CADRE`, voir `analyserQualitePhoto.ts`),
 *  en fixant chaque pixel via `valeurAt(x, y)` (même niveau sur R/G/B, alpha 255). */
function creerDonneesPixels(
  largeur: number,
  hauteur: number,
  valeurAt: (x: number, y: number) => number,
): { data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const base = (y * largeur + x) * 4;
      const valeur = valeurAt(x, y);
      data[base] = valeur;
      data[base + 1] = valeur;
      data[base + 2] = valeur;
      data[base + 3] = 255;
    }
  }
  return { data };
}

// Dimensions de l'échantillon telles que calculées par `analyserQualitePhoto.ts`
// (`LARGEUR_ECHANTILLON = 240`, hauteur dérivée de `RATIO_CADRE`) — dupliquées ici plutôt
// qu'importées : ce ne sont pas des constantes exportées (détail d'implémentation interne), le
// test doit rester correct même si elles bougent légèrement tant que la forme du calcul ne change
// pas.
const LARGEUR_ECHANTILLON = 240;
const HAUTEUR_ECHANTILLON = Math.round(240 / 1.42);

function installerCanvasFactice(donneesPixels: { data: Uint8ClampedArray } | 'indisponible'): void {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
    if (donneesPixels === 'indisponible') return null;
    return {
      drawImage: vi.fn(),
      getImageData: vi.fn(() => donneesPixels),
    } as unknown as CanvasRenderingContext2D;
  });
}

function fichier(nom = 'permis.jpg', type = 'image/jpeg'): File {
  return new File(['contenu-factice'], nom, { type });
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:objet-1'),
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fonctions pures', () => {
  it('variance() : un tableau constant a une variance nulle', () => {
    expect(variance([100, 100, 100, 100])).toBe(0);
  });

  it('variance() : des valeurs qui alternent aux extrêmes ont une variance élevée', () => {
    expect(variance([0, 255, 0, 255])).toBeGreaterThan(10000);
  });

  it('nuancesDeGris() : convertit RGBA en un niveau de gris par pixel (poids ITU-R BT.601)', () => {
    // Un seul pixel blanc pur -> gris ~255 ; un seul pixel noir pur -> gris 0.
    const blanc = nuancesDeGris({ data: new Uint8ClampedArray([255, 255, 255, 255]) });
    const noir = nuancesDeGris({ data: new Uint8ClampedArray([0, 0, 0, 255]) });
    expect(blanc[0]).toBeCloseTo(255, 0);
    expect(noir[0]).toBe(0);
  });

  it('varianceLaplacien() : une grille uniforme a une variance de laplacien nulle', () => {
    const gris = new Float64Array(10 * 10).fill(128);
    expect(varianceLaplacien(gris, 10, 10)).toBe(0);
  });

  it('varianceLaplacien() : un dégradé LINÉAIRE (transition douce, "floue") a une variance de laplacien quasi nulle malgré une forte variance de luminance', () => {
    const largeur = 20;
    const hauteur = 20;
    const gris = new Float64Array(largeur * hauteur);
    for (let y = 0; y < hauteur; y += 1) {
      for (let x = 0; x < largeur; x += 1) {
        gris[y * largeur + x] = (x / (largeur - 1)) * 255; // rampe linéaire 0 -> 255
      }
    }
    expect(variance(gris)).toBeGreaterThan(1000); // forte variance de luminance
    expect(varianceLaplacien(gris, largeur, hauteur)).toBeLessThan(1); // mais quasi aucun relief
  });

  it('varianceLaplacien() : un damier (transitions abruptes, "net") a une variance de laplacien élevée', () => {
    const largeur = 20;
    const hauteur = 20;
    const gris = new Float64Array(largeur * hauteur);
    for (let y = 0; y < hauteur; y += 1) {
      for (let x = 0; x < largeur; x += 1) {
        gris[y * largeur + x] = (x + y) % 2 === 0 ? 0 : 255;
      }
    }
    expect(varianceLaplacien(gris, largeur, hauteur)).toBeGreaterThan(10000);
  });
});

describe('analyserQualitePhoto', () => {
  it('accepte une photo haute résolution, contrastée et nette (damier) : aucun motif de refus', async () => {
    installerImageFactice('succes', { largeur: 3000, hauteur: 2200 });
    installerCanvasFactice(
      creerDonneesPixels(LARGEUR_ECHANTILLON, HAUTEUR_ECHANTILLON, (x, y) =>
        (x + y) % 2 === 0 ? 20 : 235,
      ),
    );

    const resultat = await analyserQualitePhoto(fichier());

    expect(resultat.motifRefus).toBeUndefined();
    expect(resultat.zone.largeur).toBeGreaterThan(0);
  });

  it('un document qui remplit tout le cadre sans la moindre marge est refusé avec un motif structurel (marge/à-plat), AVANT la détection de bords', async () => {
    // Même dimensions que le test « accepte... » ci-dessus (3000x2200) : le premier contrôle de
    // résolution passe largement. `detecterAnomalieCadrage` réduit l'image à DIMENSION_ANALYSE_PX
    // (320px de plus grand côté) -> ici 320x235 -- voir `detecterAnomaliesCadrage.ts`. Le tampon
    // fourni (fond gris clair, 1px de marge tout autour) reproduit EXACTEMENT le cas synthétique
    // vérifié dans `detecterAnomaliesCadrage.spec.ts` (« document qui remplit tout le cadre sans la
    // moindre marge ») : sur ce cas extrême et parfaitement uniforme, le signal brut s'inverse et
    // classe l'anomalie comme `pageNonAPlat` — voir la doc de tête de ce module pour pourquoi
    // `margeInsuffisante`, elle, n'est reproductible qu'avec du vrai bruit de photo (couvert par les
    // mesures réelles du corpus dans `detecterAnomaliesCadrage.spec.ts`, pas ici).
    installerImageFactice('succes', { largeur: 3000, hauteur: 2200 });
    const largeurReduite = 320;
    const hauteurReduite = Math.round((2200 * 320) / 3000);
    installerCanvasFactice(
      creerDonneesPixels(largeurReduite, hauteurReduite, (x, y) =>
        x >= 1 && x < largeurReduite - 1 && y >= 1 && y < hauteurReduite - 1 ? 20 : 200,
      ),
    );

    const resultat = await analyserQualitePhoto(fichier());

    expect(resultat.motifRefus).toBe('pageNonAPlat');
    expect(resultat.cadrageDetecte).toBe(false);
  });

  it('une photo dont la zone recadrée tombe sous le seuil de résolution est refusée SANS même toucher au canevas', async () => {
    installerImageFactice('succes', { largeur: 800, hauteur: 600 });
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');

    const resultat = await analyserQualitePhoto(fichier());

    expect(resultat.motifRefus).toBe('resolutionInsuffisante');
    expect(getContext).not.toHaveBeenCalled();
  });

  it('une zone quasi uniforme (aucun contenu détecté) est refusée comme "documentTropPetit"', async () => {
    installerImageFactice('succes', { largeur: 3000, hauteur: 2200 });
    installerCanvasFactice(creerDonneesPixels(LARGEUR_ECHANTILLON, HAUTEUR_ECHANTILLON, () => 180));

    const resultat = await analyserQualitePhoto(fichier());

    expect(resultat.motifRefus).toBe('documentTropPetit');
  });

  it('une zone contrastée mais aux transitions douces (floue) est refusée comme "photoFloue"', async () => {
    installerImageFactice('succes', { largeur: 3000, hauteur: 2200 });
    installerCanvasFactice(
      creerDonneesPixels(LARGEUR_ECHANTILLON, HAUTEUR_ECHANTILLON, (x) =>
        Math.round((x / (LARGEUR_ECHANTILLON - 1)) * 255),
      ),
    );

    const resultat = await analyserQualitePhoto(fichier());

    expect(resultat.motifRefus).toBe('photoFloue');
  });

  it('sans canevas 2D disponible, se dégrade au seul contrôle de résolution : jamais de refus fabriqué, jamais un "accepté" qu’elle n’a pas vérifié comme tel — la zone reste tout de même renvoyée', async () => {
    installerImageFactice('succes', { largeur: 3000, hauteur: 2200 });
    installerCanvasFactice('indisponible');

    const resultat = await analyserQualitePhoto(fichier());

    expect(resultat.motifRefus).toBeUndefined();
    expect(resultat.zone.largeur).toBeGreaterThan(0);
  });

  it('une photo illisible propage ErreurReductionImage (même traitement que reduireImagePourEnvoi)', async () => {
    installerImageFactice('echec');

    await expect(analyserQualitePhoto(fichier('IMG.HEIC', 'image/heic'))).rejects.toBeInstanceOf(
      ErreurReductionImage,
    );
  });

  it('révoque TOUJOURS l’URL d’objet créée pour le décodage, succès comme échec', async () => {
    const revoquer = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoquer, configurable: true });

    installerImageFactice('succes', { largeur: 3000, hauteur: 2200 });
    installerCanvasFactice(creerDonneesPixels(LARGEUR_ECHANTILLON, HAUTEUR_ECHANTILLON, () => 180));
    await analyserQualitePhoto(fichier());
    expect(revoquer).toHaveBeenCalledWith('blob:objet-1');

    revoquer.mockClear();
    installerImageFactice('echec');
    await analyserQualitePhoto(fichier()).catch(() => undefined);
    expect(revoquer).toHaveBeenCalledWith('blob:objet-1');
  });
});
