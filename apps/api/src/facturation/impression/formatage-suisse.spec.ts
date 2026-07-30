import { describe, expect, it } from 'vitest';

import { formaterDateSuisse, formaterMontantCentimes } from './formatage-suisse';

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
