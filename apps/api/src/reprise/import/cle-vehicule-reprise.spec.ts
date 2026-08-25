import { describe, expect, it } from 'vitest';

import { calculerCleVehicule, normaliserVin } from './cle-vehicule-reprise';

describe("normaliserVin — piège vérifié : un VIN qui n'a pas 17 caractères ne doit jamais devenir une clé", () => {
  it('VIN valide (17 caractères alphanumériques) -> normalisé en majuscules', () => {
    expect(normaliserVin('wvwzzz1kzaw123456')).toBe('WVWZZZ1KZAW123456');
  });

  it('VIN de 6 caractères (courant sur les archives pré-2010) -> REJETÉ, pas juste raccourci', () => {
    expect(normaliserVin('123456')).toBeNull();
  });

  it('placeholders fréquents dans les DMS hérités -> rejetés', () => {
    expect(normaliserVin('0')).toBeNull();
    expect(normaliserVin('N/A')).toBeNull();
    expect(normaliserVin('-')).toBeNull();
    expect(normaliserVin('')).toBeNull();
    expect(normaliserVin(null)).toBeNull();
  });

  it('espaces internes tolérés puis retirés avant validation', () => {
    expect(normaliserVin('WVW ZZZ 1KZ AW1 234 56')).toBe('WVWZZZ1KZAW123456');
  });

  it('I, O, Q exclus par la norme ISO 3779 -> rejetés même à 17 caractères', () => {
    expect(normaliserVin('WVWZZZ1KZAWI23456')).toBeNull();
  });
});

describe('calculerCleVehicule', () => {
  it('VIN fiable -> clé fondée sur le VIN', () => {
    const cle = calculerCleVehicule('WVWZZZ1KZAW123456', 'ORIG-42');
    expect(cle).toEqual({ cle: 'vin:WVWZZZ1KZAW123456', fondeeSurVin: true });
  });

  it('VIN non fiable (mauvaise longueur) -> repli sur numeroOrigine, JAMAIS le VIN suspect comme clé', () => {
    const cle = calculerCleVehicule('123456', 'ORIG-42');
    expect(cle).toEqual({ cle: 'origine:ORIG-42', fondeeSurVin: false });
  });

  it('VIN absent -> repli sur numeroOrigine', () => {
    expect(calculerCleVehicule(null, 'ORIG-7')).toEqual({
      cle: 'origine:ORIG-7',
      fondeeSurVin: false,
    });
  });

  it('deux véhicules avec le même VIN COURT invalide ne partagent PAS la même clé (repli distinct par origine)', () => {
    const a = calculerCleVehicule('0', 'ORIG-1');
    const b = calculerCleVehicule('0', 'ORIG-2');
    expect(a.cle).not.toBe(b.cle);
  });
});
