import { describe, expect, it } from 'vitest';

import { centimesVersSaisie, francsVersCentimes } from './montants';

describe('francsVersCentimes', () => {
  it('accepte la virgule décimale', () => {
    expect(francsVersCentimes('1234,50')).toBe(123450);
  });

  it('accepte le point décimal et les apostrophes de milliers', () => {
    expect(francsVersCentimes("1'234.50")).toBe(123450);
  });

  it('rejette plus de deux décimales', () => {
    expect(francsVersCentimes('12.345')).toBeNull();
  });

  it('rejette un montant négatif', () => {
    expect(francsVersCentimes('-5')).toBeNull();
  });

  it('accepte un montant entier sans décimale', () => {
    expect(francsVersCentimes('50')).toBe(5000);
  });

  it('complète une seule décimale à droite', () => {
    expect(francsVersCentimes('50.5')).toBe(5050);
  });

  it('rejette une saisie vide', () => {
    expect(francsVersCentimes('')).toBeNull();
    expect(francsVersCentimes('   ')).toBeNull();
  });

  it('rejette une saisie non numérique', () => {
    expect(francsVersCentimes('abc')).toBeNull();
    expect(francsVersCentimes('12.5.0')).toBeNull();
  });
});

describe('centimesVersSaisie', () => {
  it('convertit des centimes en saisie francs à point décimal', () => {
    expect(centimesVersSaisie(123450)).toBe('1234.50');
  });

  it('gère les montants négatifs (avoir)', () => {
    expect(centimesVersSaisie(-5000)).toBe('-50.00');
  });

  it('gère zéro', () => {
    expect(centimesVersSaisie(0)).toBe('0.00');
  });

  it('rejette une valeur non entière', () => {
    expect(() => centimesVersSaisie(10.5)).toThrow(TypeError);
  });

  it('est réciproque de francsVersCentimes sur un aller-retour', () => {
    const saisie = '1234.50';
    const centimes = francsVersCentimes(saisie);
    expect(centimes).not.toBeNull();
    expect(centimesVersSaisie(centimes as number)).toBe(saisie);
  });
});
