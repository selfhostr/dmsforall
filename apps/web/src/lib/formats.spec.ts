import { describe, expect, it } from 'vitest';

import { formaterDate, formaterMontant } from './formats';

describe('formaterMontant', () => {
  it('formate des centimes en 1’234.50 avec apostrophe droite (pas typographique)', () => {
    expect(formaterMontant(123450)).toBe("1'234.50");
  });

  it('conserve deux décimales même sur un montant rond', () => {
    expect(formaterMontant(10000)).toBe('100.00');
  });

  it('gère les montants négatifs (avoir)', () => {
    expect(formaterMontant(-5000)).toBe('-50.00');
  });

  it('gère zéro', () => {
    expect(formaterMontant(0)).toBe('0.00');
  });

  it('rejette un montant non entier (les centimes sont toujours un entier)', () => {
    expect(() => formaterMontant(10.5)).toThrow(TypeError);
  });
});

describe('formaterDate', () => {
  it('formate en jj.mm.aaaa', () => {
    expect(formaterDate(new Date(2026, 6, 27))).toBe('27.07.2026');
  });

  it('accepte une chaîne ISO', () => {
    expect(formaterDate('2026-01-05T10:00:00.000Z')).toMatch(/^\d{2}\.\d{2}\.2026$/);
  });
});
