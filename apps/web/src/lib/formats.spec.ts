import { describe, expect, it } from 'vitest';

import {
  formaterDate,
  formaterDateHeure,
  formaterHeure,
  formaterKilometrage,
  formaterMontant,
  formaterPourmille,
} from './formats';

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

describe('formaterHeure', () => {
  it('formate en HH:MM sur 24 h', () => {
    expect(formaterHeure(new Date(2026, 6, 27, 8, 5))).toBe('08:05');
  });

  it('ne rend jamais 24:00 à minuit (hourCycle h23)', () => {
    expect(formaterHeure(new Date(2026, 6, 27, 0, 0))).toBe('00:00');
  });
});

describe('formaterDateHeure', () => {
  it('combine date et heure suisses', () => {
    expect(formaterDateHeure(new Date(2026, 6, 27, 14, 30))).toBe('27.07.2026 14:30');
  });
});

describe('formaterKilometrage', () => {
  it("groupe les milliers avec l'apostrophe droite et ajoute l'unité", () => {
    expect(formaterKilometrage(125340, 'km')).toBe("125'340 km");
  });

  it("change de suffixe quand l'unité change (aucune unité codée en dur)", () => {
    expect(formaterKilometrage(125340, 'mi')).toBe("125'340 mi");
  });

  it('rejette une valeur non entière', () => {
    expect(() => formaterKilometrage(10.5, 'km')).toThrow(TypeError);
  });
});

describe('formaterPourmille', () => {
  it('convertit un taux TVA en pourcentage à une décimale', () => {
    expect(formaterPourmille(81)).toBe('8.1 %');
  });

  it('gère 100% (1000 pour mille)', () => {
    expect(formaterPourmille(1000)).toBe('100.0 %');
  });

  it('gère zéro', () => {
    expect(formaterPourmille(0)).toBe('0.0 %');
  });

  it('rejette une valeur non entière', () => {
    expect(() => formaterPourmille(8.1)).toThrow(TypeError);
  });
});
