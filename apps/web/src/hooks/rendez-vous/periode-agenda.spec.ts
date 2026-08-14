import { describe, expect, it } from 'vitest';

import { ajouterJours, debutSemaine, joursDeLaSemaine, versDateIsoLocale } from './periode-agenda';

describe('debutSemaine', () => {
  it('rend le lundi pour une date en milieu de semaine', () => {
    // Jeudi 13 août 2026
    expect(versDateIsoLocale(debutSemaine(new Date(2026, 7, 13)))).toBe('2026-08-10');
  });

  it('rend le lundi pour un dimanche (dernier jour de la semaine suisse)', () => {
    expect(versDateIsoLocale(debutSemaine(new Date(2026, 7, 16)))).toBe('2026-08-10');
  });

  it('est idempotent pour un lundi', () => {
    expect(versDateIsoLocale(debutSemaine(new Date(2026, 7, 10)))).toBe('2026-08-10');
  });
});

describe('joursDeLaSemaine', () => {
  it('rend sept jours consécutifs, du lundi au dimanche', () => {
    const jours = joursDeLaSemaine(new Date(2026, 7, 13));
    expect(jours).toHaveLength(7);
    expect(jours.map(versDateIsoLocale)).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
      '2026-08-16',
    ]);
  });
});

describe('ajouterJours', () => {
  it('avance ou recule sans déborder de mois en heure locale', () => {
    expect(versDateIsoLocale(ajouterJours(new Date(2026, 7, 31), 1))).toBe('2026-09-01');
    expect(versDateIsoLocale(ajouterJours(new Date(2026, 8, 1), -1))).toBe('2026-08-31');
  });
});
