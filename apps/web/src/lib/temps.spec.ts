import { describe, expect, it } from 'vitest';

import { centiemesVersHeures, formaterEcartTemps, formaterTempsCentiemes } from './temps';

describe('centiemesVersHeures', () => {
  it('convertit des centièmes d’heure en heures décimales', () => {
    expect(centiemesVersHeures(120)).toBe(1.2);
  });

  it('rejette une valeur non entière', () => {
    expect(() => centiemesVersHeures(1.5)).toThrow(TypeError);
  });
});

describe('formaterTempsCentiemes', () => {
  it('affiche en heures décimales avec le suffixe h', () => {
    expect(formaterTempsCentiemes(120, 'heuresDecimales')).toBe('1.2 h');
  });

  it('change de suffixe quand l’unité change, sans changer la mécanique (aucune unité en dur)', () => {
    expect(formaterTempsCentiemes(120, 'unitesConstructeur')).toBe('1.2 UT');
  });

  it('gère zéro', () => {
    expect(formaterTempsCentiemes(0, 'heuresDecimales')).toBe('0.0 h');
  });
});

describe('formaterEcartTemps', () => {
  it('signe un écart positif', () => {
    expect(formaterEcartTemps(120, 'heuresDecimales')).toBe('+1.2 h');
  });

  it('signe un écart négatif', () => {
    expect(formaterEcartTemps(-50, 'heuresDecimales')).toBe('-0.5 h');
  });

  it('signe un écart nul', () => {
    expect(formaterEcartTemps(0, 'heuresDecimales')).toBe('+0.0 h');
  });

  it("respecte l'unité passée pour le suffixe", () => {
    expect(formaterEcartTemps(120, 'unitesConstructeur')).toBe('+1.2 UT');
  });
});
