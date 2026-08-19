import { describe, expect, it } from 'vitest';

import {
  carteDistancesCouleur,
  couleurMedianeDuBord,
  detecterBordsDepuisPixels,
  plusGrandComposantConnexe,
  seuilOtsu,
  type TamponPixels,
} from './detecterBordsDocument';

/** Construit un tampon RGBA `largeur x hauteur` où chaque pixel vaut `fond` sauf ceux situés dans le
 *  rectangle `[x, x+w) x [y, y+h)`, qui valent `avantPlan`. Même esprit que `creerDonneesPixels`
 *  dans `analyserQualitePhoto.spec.ts` : un fond uniforme et un rectangle net, cas le plus simple et
 *  le plus lisible pour vérifier la géométrie produite. */
function tamponAvecRectangle(
  largeur: number,
  hauteur: number,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  fond: readonly [number, number, number] = [200, 200, 200],
  avantPlan: readonly [number, number, number] = [20, 20, 20],
): { largeur: number; hauteur: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const dansRect = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const [r, v, b] = dansRect ? avantPlan : fond;
      const base = (y * largeur + x) * 4;
      data[base] = r;
      data[base + 1] = v;
      data[base + 2] = b;
      data[base + 3] = 255;
    }
  }
  return { largeur, hauteur, data };
}

describe('couleurMedianeDuBord', () => {
  it('renvoie la couleur du fond, indifférente à un contenu central très différent', () => {
    const tampon = tamponAvecRectangle(40, 30, { x: 10, y: 8, w: 20, h: 14 });
    expect(couleurMedianeDuBord(tampon)).toEqual([200, 200, 200]);
  });

  it('reste correcte même si un coin est occulté par une couleur différente (médiane sur toute la bande, pas seulement les coins)', () => {
    const tampon = tamponAvecRectangle(40, 30, { x: 10, y: 8, w: 20, h: 14 });
    // Contamine un seul coin (5x5, un « doigt ») avec une couleur très différente.
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const base = (y * 40 + x) * 4;
        tampon.data[base] = 10;
        tampon.data[base + 1] = 10;
        tampon.data[base + 2] = 10;
      }
    }
    expect(couleurMedianeDuBord(tampon)).toEqual([200, 200, 200]);
  });
});

describe('carteDistancesCouleur', () => {
  it('vaut 0 sur les pixels de la couleur de référence, et la distance euclidienne exacte ailleurs', () => {
    const tampon: TamponPixels = {
      largeur: 2,
      hauteur: 1,
      data: new Uint8ClampedArray([200, 200, 200, 255, 203, 204, 200, 255]),
    };
    const distances = carteDistancesCouleur(tampon, [200, 200, 200]);
    expect(distances[0]).toBe(0);
    expect(distances[1]).toBeCloseTo(Math.sqrt(3 * 3 + 4 * 4), 10); // 3-4-5
  });
});

describe('seuilOtsu', () => {
  it('sépare deux populations bien distinctes exactement entre les deux clusters', () => {
    const histogramme = new Array<number>(256).fill(0);
    histogramme[10] = 500; // population basse
    histogramme[240] = 500; // population haute
    const seuil = seuilOtsu(histogramme);
    // Le seuil peut tomber exactement sur le bord de la population basse (Otsu maximise la
    // variance INTER-classe ; à 10, les deux classes sont déjà parfaitement séparées, donc rien ne
    // pousse le seuil plus haut) — ce qui compte est la SÉPARATION effective, vérifiée juste après :
    // avec le test `bins[p] > seuilBin` utilisé par `detecterBordsDepuisPixels`, un seuil de 10
    // classe déjà le bin 10 en arrière-plan et le bin 240 en premier plan.
    expect(seuil).toBeGreaterThanOrEqual(10);
    expect(seuil).toBeLessThan(240);
  });

  it('histogramme vide -> seuil 0 (jamais une erreur)', () => {
    expect(seuilOtsu(new Array<number>(256).fill(0))).toBe(0);
  });
});

describe('plusGrandComposantConnexe', () => {
  it('choisit le plus grand des deux blobs et calcule sa boîte englobante exacte', () => {
    const largeur = 10;
    const hauteur = 10;
    const masque = new Uint8Array(largeur * hauteur);
    // Petit blob (2x2) en haut à gauche.
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      masque[y! * largeur + x!] = 1;
    }
    // Grand blob (4x3) au centre.
    for (let y = 5; y < 8; y += 1) {
      for (let x = 4; x < 8; x += 1) {
        masque[y * largeur + x] = 1;
      }
    }
    const composant = plusGrandComposantConnexe(masque, largeur, hauteur);
    expect(composant).toEqual({ nbPixels: 12, minX: 4, maxX: 7, minY: 5, maxY: 7 });
  });

  it('masque entièrement vide -> null', () => {
    expect(plusGrandComposantConnexe(new Uint8Array(100), 10, 10)).toBeNull();
  });
});

describe('detecterBordsDepuisPixels', () => {
  it('détecte un rectangle net et bien proportionné avec confiance, en fractions cohérentes', () => {
    // Rectangle 60x40 dans un tampon 100x100 (aire = 24 %, remplissage = 100 %, un rectangle plein
    // remplit parfaitement sa propre boîte englobante).
    const tampon = tamponAvecRectangle(100, 100, { x: 20, y: 30, w: 60, h: 40 });
    const resultat = detecterBordsDepuisPixels(tampon);

    expect(resultat).not.toBeNull();
    // Les fractions retombent près du rectangle réel, à la marge de confort (MARGE_PADDING_FRAC)
    // près.
    expect(resultat!.fractions.xFrac).toBeCloseTo(0.2, 1);
    expect(resultat!.fractions.yFrac).toBeCloseTo(0.3, 1);
    expect(resultat!.fractions.largeurFrac).toBeCloseTo(0.6, 1);
    expect(resultat!.fractions.hauteurFrac).toBeCloseTo(0.4, 1);
    expect(resultat!.remplissage).toBeCloseTo(1, 5);
  });

  it('une photo parfaitement uniforme (rien à détecter) renvoie null', () => {
    const tampon = tamponAvecRectangle(50, 50, { x: 0, y: 0, w: 0, h: 0 }); // rectangle vide -> fond partout
    expect(detecterBordsDepuisPixels(tampon)).toBeNull();
  });

  it('un contenu trop petit par rapport à la photo (probablement du bruit) est écarté (sous AIRE_MIN_FRAC)', () => {
    const tampon = tamponAvecRectangle(100, 100, { x: 48, y: 48, w: 4, h: 4 }); // aire = 0.16 %
    expect(detecterBordsDepuisPixels(tampon)).toBeNull();
  });

  it('un contenu qui couvre presque toute la photo (le fond ne s’est pas assez distingué) est écarté (au-dessus d’AIRE_MAX_FRAC)', () => {
    const tampon = tamponAvecRectangle(100, 100, { x: 1, y: 1, w: 98, h: 98 }); // aire = 96 %
    expect(detecterBordsDepuisPixels(tampon)).toBeNull();
  });

  it('un contenu troué/irrégulier (mauvais remplissage de sa boîte englobante) est écarté même si sa taille est plausible', () => {
    const largeur = 100;
    const hauteur = 100;
    const data = new Uint8ClampedArray(largeur * hauteur * 4);
    for (let p = 0; p < largeur * hauteur; p += 1) {
      data[p * 4] = 200;
      data[p * 4 + 1] = 200;
      data[p * 4 + 2] = 200;
      data[p * 4 + 3] = 255;
    }
    // Deux petits carrés disjoints aux coins opposés d'une grande boîte englobante : ensemble, la
    // boîte englobante est grande (aire plausible) mais très peu REMPLIE (les 3/4 de la boîte sont
    // du fond) — jamais la forme d'un document réel.
    for (const [ox, oy] of [
      [10, 10],
      [80, 80],
    ]) {
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          const base = ((oy! + y) * largeur + (ox! + x)) * 4;
          data[base] = 20;
          data[base + 1] = 20;
          data[base + 2] = 20;
        }
      }
    }
    expect(detecterBordsDepuisPixels({ largeur, hauteur, data })).toBeNull();
  });

  it('un tampon dont la longueur de données ne correspond pas à largeur*hauteur*4 est refusé sans tenter de lire hors bornes', () => {
    const tampon: TamponPixels = { largeur: 10, hauteur: 10, data: new Uint8ClampedArray(4) };
    expect(detecterBordsDepuisPixels(tampon)).toBeNull();
  });

  it('fonctionne identiquement pour un tampon portrait et un tampon paysage (aucune hypothèse d’orientation)', () => {
    const paysage = tamponAvecRectangle(120, 80, { x: 20, y: 15, w: 80, h: 50 });
    const portrait = tamponAvecRectangle(80, 120, { x: 10, y: 30, w: 60, h: 70 });
    expect(detecterBordsDepuisPixels(paysage)).not.toBeNull();
    expect(detecterBordsDepuisPixels(portrait)).not.toBeNull();
  });
});
