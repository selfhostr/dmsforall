import { describe, expect, it } from 'vitest';

import {
  PROPORTION_CADRE,
  RATIO_CADRE,
  calculerFractionsCadre,
  calculerZoneCadre,
  zoneEnPixels,
} from './geometrieCadre';

describe('calculerFractionsCadre', () => {
  it('centre le cadre : les marges gauche/droite et haut/bas sont égales', () => {
    const fractions = calculerFractionsCadre(3000, 4000);
    expect(fractions.xFrac).toBeCloseTo(1 - fractions.xFrac - fractions.largeurFrac, 10);
    expect(fractions.yFrac).toBeCloseTo(1 - fractions.yFrac - fractions.hauteurFrac, 10);
  });

  it('sur une photo au moins aussi large que le cadre (paysage), la HAUTEUR est la dimension limitante', () => {
    // Photo très large (ratio 3:1, très supérieur à RATIO_CADRE) : le cadre occupe PROPORTION_CADRE
    // de la hauteur, jamais de la largeur (sinon il dépasserait verticalement).
    const fractions = calculerFractionsCadre(3000, 1000);
    expect(fractions.hauteurFrac).toBeCloseTo(PROPORTION_CADRE, 10);
    expect(fractions.largeurFrac).toBeLessThan(PROPORTION_CADRE);
  });

  it('sur une photo portrait (plus haute que large), la LARGEUR est la dimension limitante', () => {
    const fractions = calculerFractionsCadre(1200, 2000);
    expect(fractions.largeurFrac).toBeCloseTo(PROPORTION_CADRE, 10);
    expect(fractions.hauteurFrac).toBeLessThan(PROPORTION_CADRE);
  });

  it('le rectangle produit respecte toujours RATIO_CADRE, quelle que soit l’orientation de la photo', () => {
    for (const [largeur, hauteur] of [
      [3000, 4000],
      [4000, 3000],
      [1000, 1000],
      [3000, 1000],
      [1000, 3000],
    ] as const) {
      const fractions = calculerFractionsCadre(largeur, hauteur);
      const largeurAbs = fractions.largeurFrac * largeur;
      const hauteurAbs = fractions.hauteurFrac * hauteur;
      expect(largeurAbs / hauteurAbs).toBeCloseTo(RATIO_CADRE, 5);
    }
  });

  it('le cadre tient toujours entièrement dans la photo (jamais de fraction hors [0, 1])', () => {
    for (const [largeur, hauteur] of [
      [3000, 4000],
      [4000, 3000],
      [1, 1],
    ] as const) {
      const fractions = calculerFractionsCadre(largeur, hauteur);
      expect(fractions.xFrac).toBeGreaterThanOrEqual(0);
      expect(fractions.yFrac).toBeGreaterThanOrEqual(0);
      expect(fractions.xFrac + fractions.largeurFrac).toBeLessThanOrEqual(1 + 1e-9);
      expect(fractions.yFrac + fractions.hauteurFrac).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('zoneEnPixels', () => {
  it('convertit des fractions connues en pixels arrondis', () => {
    const fractions = { xFrac: 0.1, yFrac: 0.2, largeurFrac: 0.8, hauteurFrac: 0.6 };
    expect(zoneEnPixels(fractions, 1000, 500)).toEqual({
      x: 100,
      y: 100,
      largeur: 800,
      hauteur: 300,
    });
  });
});

describe('calculerZoneCadre', () => {
  it('compose calculerFractionsCadre et zoneEnPixels sans divergence', () => {
    const fractions = calculerFractionsCadre(3840, 2160);
    expect(calculerZoneCadre(3840, 2160)).toEqual(zoneEnPixels(fractions, 3840, 2160));
  });

  it('sur une photo carrée, produit un rectangle plus large que haut (RATIO_CADRE > 1)', () => {
    const zone = calculerZoneCadre(2000, 2000);
    expect(zone.largeur).toBeGreaterThan(zone.hauteur);
  });
});
