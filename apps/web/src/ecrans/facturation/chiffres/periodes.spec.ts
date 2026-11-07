import { describe, expect, it } from 'vitest';

import { periodesChiffres } from './periodes';

describe('periodesChiffres', () => {
  it('mois en cours, mois précédent et année civile', () => {
    expect(periodesChiffres('2026-11-07')).toEqual({
      moisCourant: { du: '2026-11-01', au: '2026-11-30' },
      moisPrecedent: { du: '2026-10-01', au: '2026-10-31' },
      annee: { du: '2026-01-01', au: '2026-12-31' },
    });
  });

  it('janvier : le mois précédent est décembre de l’année d’avant', () => {
    expect(periodesChiffres('2026-01-15').moisPrecedent).toEqual({
      du: '2025-12-01',
      au: '2025-12-31',
    });
  });

  it('février bissextile et non bissextile', () => {
    expect(periodesChiffres('2024-02-10').moisCourant.au).toBe('2024-02-29');
    expect(periodesChiffres('2026-03-10').moisPrecedent.au).toBe('2026-02-28');
  });
});
