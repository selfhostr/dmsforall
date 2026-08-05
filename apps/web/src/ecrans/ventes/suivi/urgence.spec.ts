import { describe, expect, it } from 'vitest';

import { calculerJoursRestants, determinerNiveauUrgence } from './urgence';

const AUJOURD_HUI = new Date('2026-08-05T14:00:00.000Z');

describe('calculerJoursRestants', () => {
  it('0 pour une échéance aujourd’hui, quelle que soit l’heure de référence', () => {
    expect(calculerJoursRestants('2026-08-05', AUJOURD_HUI)).toBe(0);
  });

  it('valeur positive pour une échéance future', () => {
    expect(calculerJoursRestants('2026-09-04', AUJOURD_HUI)).toBe(30);
  });

  it('valeur négative pour une échéance déjà dépassée', () => {
    expect(calculerJoursRestants('2026-07-26', AUJOURD_HUI)).toBe(-10);
  });
});

describe('determinerNiveauUrgence', () => {
  it('echue pour un nombre de jours négatif', () => {
    expect(determinerNiveauUrgence(-1)).toBe('echue');
    expect(determinerNiveauUrgence(-100)).toBe('echue');
  });

  it('imminente entre 0 et 7 jours', () => {
    expect(determinerNiveauUrgence(0)).toBe('imminente');
    expect(determinerNiveauUrgence(7)).toBe('imminente');
  });

  it('proche entre 8 et 30 jours', () => {
    expect(determinerNiveauUrgence(8)).toBe('proche');
    expect(determinerNiveauUrgence(30)).toBe('proche');
  });

  it('lointaine au-delà de 30 jours', () => {
    expect(determinerNiveauUrgence(31)).toBe('lointaine');
    expect(determinerNiveauUrgence(365)).toBe('lointaine');
  });
});
