import { describe, expect, it } from 'vitest';

import {
  formaterDateSuisse,
  formaterMontantAvecDevise,
  formaterMontantCentimes,
} from './formatage-suisse';

describe('formaterMontantCentimes', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [100, '1.00'],
    [7000, '70.00'],
    [99, '0.99'],
    [100050, "1'000.50"],
    [123456789, "1'234'567.89"],
    [-500, '-5.00'],
    [-100050, "-1'000.50"],
    [1000000, "10'000.00"],
  ])('formaterMontantCentimes(%d) === %s', (centimes, attendu) => {
    expect(formaterMontantCentimes(centimes)).toBe(attendu);
  });

  it('refuse un montant non entier', () => {
    expect(() => formaterMontantCentimes(10.5)).toThrow(RangeError);
  });
});

/**
 * Bug #126 (PDF facture) : le corps du PDF (lignes, ventilation TVA, totaux) affichait des
 * montants nus, sans devise — seul le bulletin QR la portait. Valeurs exactes attendues, jamais
 * `toBeCloseTo` — l'arithmétique se prouve, elle ne se relit pas (`CONTRIBUTING.md`).
 */
describe('formaterMontantAvecDevise', () => {
  it.each([
    [25944, 'CHF', 'CHF 259.44'],
    [0, 'CHF', 'CHF 0.00'],
    [10000, 'EUR', 'EUR 100.00'],
    [-500, 'CHF', 'CHF -5.00'],
    [123456789, 'CHF', "CHF 1'234'567.89"],
  ] as const)('formaterMontantAvecDevise(%d, %s) === %s', (centimes, devise, attendu) => {
    expect(formaterMontantAvecDevise(centimes, devise)).toBe(attendu);
  });

  it('même corps que formaterMontantCentimes, seul le préfixe devise change', () => {
    expect(formaterMontantAvecDevise(100050, 'CHF')).toBe(`CHF ${formaterMontantCentimes(100050)}`);
    expect(formaterMontantAvecDevise(100050, 'EUR')).toBe(`EUR ${formaterMontantCentimes(100050)}`);
  });

  it('refuse un montant non entier (délègue à formaterMontantCentimes)', () => {
    expect(() => formaterMontantAvecDevise(10.5, 'CHF')).toThrow(RangeError);
  });
});

describe('formaterDateSuisse', () => {
  it.each([
    ['2026-07-29', '29.07.2026'],
    ['2026-01-01', '01.01.2026'],
    ['2026-12-31T00:00:00.000Z', '31.12.2026'],
  ])('formaterDateSuisse(%s) === %s', (iso, attendu) => {
    expect(formaterDateSuisse(iso)).toBe(attendu);
  });

  it('refuse une date mal formée', () => {
    expect(() => formaterDateSuisse('29/07/2026')).toThrow(RangeError);
  });
});
