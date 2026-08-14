import { describe, expect, it } from 'vitest';

import {
  calculerEtatCapaciteJour,
  capaciteMinutesDepuisCentiemes,
  dureeMinutesDepuisMotif,
  enumererDatesInclusives,
} from './calcul-capacite';

describe('calculerEtatCapaciteJour — règle maison : non défini ≠ zéro ≠ disponible', () => {
  it('capaciteMinutes null → "non_definie", même avec 0 minute occupée (jamais "disponible")', () => {
    expect(calculerEtatCapaciteJour(0, null)).toBe('non_definie');
  });

  it('capaciteMinutes null → "non_definie" même avec une forte occupation (jamais "complete")', () => {
    expect(calculerEtatCapaciteJour(10_000, null)).toBe('non_definie');
  });

  it('occupation strictement inférieure à la capacité → "disponible"', () => {
    expect(calculerEtatCapaciteJour(100, 480)).toBe('disponible');
  });

  it('occupation égale à la capacité → "complete" (pas de tolérance silencieuse)', () => {
    expect(calculerEtatCapaciteJour(480, 480)).toBe('complete');
  });

  it('occupation supérieure à la capacité (surbooking déjà accepté) → "complete", jamais un refus', () => {
    expect(calculerEtatCapaciteJour(600, 480)).toBe('complete');
  });

  it('capacité paramétrée à 0 (accord requis pour tout) → "complete" dès la première minute, jamais confondu avec "non_definie"', () => {
    expect(calculerEtatCapaciteJour(1, 0)).toBe('complete');
    expect(calculerEtatCapaciteJour(0, 0)).toBe('complete');
  });
});

describe('capaciteMinutesDepuisCentiemes', () => {
  it('null reste null — jamais converti en 0', () => {
    expect(capaciteMinutesDepuisCentiemes(null)).toBeNull();
  });

  it('800 centièmes d’heure (8h/jour) → 480 minutes', () => {
    expect(capaciteMinutesDepuisCentiemes(800)).toBe(480);
  });

  it('0 centième (accord requis pour tout RDV) → 0 minute, distinct de null', () => {
    expect(capaciteMinutesDepuisCentiemes(0)).toBe(0);
  });
});

describe('dureeMinutesDepuisMotif', () => {
  it('dureeDefautMinutes prioritaire quand les deux grandeurs sont renseignées', () => {
    expect(
      dureeMinutesDepuisMotif({ dureeDefautMinutes: 90, heuresAtelierDefautCentiemes: 50 }),
    ).toBe(90);
  });

  it('repli sur heuresAtelierDefautCentiemes converti en minutes si dureeDefautMinutes absent', () => {
    expect(
      dureeMinutesDepuisMotif({ dureeDefautMinutes: null, heuresAtelierDefautCentiemes: 100 }),
    ).toBe(60);
  });

  it('null si le motif ne porte ni l’une ni l’autre grandeur — jamais un défaut inventé', () => {
    expect(
      dureeMinutesDepuisMotif({ dureeDefautMinutes: null, heuresAtelierDefautCentiemes: null }),
    ).toBeNull();
  });
});

describe('enumererDatesInclusives', () => {
  it('une seule date quand du === au', () => {
    expect(enumererDatesInclusives('2026-08-20', '2026-08-20')).toEqual(['2026-08-20']);
  });

  it('bornes inclusives, dans l’ordre', () => {
    expect(enumererDatesInclusives('2026-08-20', '2026-08-23')).toEqual([
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('traverse un changement de mois correctement', () => {
    expect(enumererDatesInclusives('2026-08-30', '2026-09-02')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('bornes inversées (au < du) rend une liste vide, jamais une erreur ni un sens inversé', () => {
    expect(enumererDatesInclusives('2026-08-23', '2026-08-20')).toEqual([]);
  });

  it('rejette une période au-delà du plafond défensif', () => {
    expect(() => enumererDatesInclusives('2026-01-01', '2026-12-31')).toThrow(/plafond/);
  });
});
