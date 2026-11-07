import { describe, expect, it } from 'vitest';

import { periodeMoisPrecedent, periodeTrimestrePrecedent, validerPeriode } from './periode';

describe('periodeMoisPrecedent', () => {
  it('rend le mois civil complet précédent', () => {
    expect(periodeMoisPrecedent(new Date(2026, 10, 7))).toEqual({
      du: '2026-10-01',
      au: '2026-10-31',
    });
  });

  it('passe à décembre de l’année précédente en janvier', () => {
    expect(periodeMoisPrecedent(new Date(2026, 0, 15))).toEqual({
      du: '2025-12-01',
      au: '2025-12-31',
    });
  });

  it('gère février d’une année bissextile', () => {
    expect(periodeMoisPrecedent(new Date(2028, 2, 3))).toEqual({
      du: '2028-02-01',
      au: '2028-02-29',
    });
  });
});

describe('periodeTrimestrePrecedent', () => {
  it('rend le trimestre civil complet précédent', () => {
    expect(periodeTrimestrePrecedent(new Date(2026, 10, 7))).toEqual({
      du: '2026-07-01',
      au: '2026-09-30',
    });
  });

  it('passe au quatrième trimestre de l’année précédente depuis le premier', () => {
    expect(periodeTrimestrePrecedent(new Date(2026, 1, 1))).toEqual({
      du: '2025-10-01',
      au: '2025-12-31',
    });
  });
});

describe('validerPeriode', () => {
  it('distingue complète, incomplète et inversée', () => {
    expect(validerPeriode('2026-10-01', '2026-10-31')).toBe('ok');
    expect(validerPeriode('2026-10-01', '2026-10-01')).toBe('ok');
    expect(validerPeriode('2026-10-01', undefined)).toBe('incomplete');
    expect(validerPeriode('2026-10-31', '2026-10-01')).toBe('inversee');
  });
});
