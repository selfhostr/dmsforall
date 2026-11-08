import { describe, expect, it } from 'vitest';

import { codeTvaParDefaut, POSTES_CODES_TVA, POSTES_COMPTES } from './catalogue-mapping';

const poste = (taux: number) => {
  const p = POSTES_CODES_TVA.find((c) => c.tauxPourmille === taux);
  if (!p) throw new Error('poste absent');
  return p;
};

describe('défauts du catalogue de mapping', () => {
  it("compte d'arrondi par défaut = 3809 (plan PME)", () => {
    expect(POSTES_COMPTES.find((p) => p.usage === 'arrondi')?.defaut).toBe('3809');
  });

  it('WinBIZ : codes TVA N81 / R26 / H38', () => {
    expect(codeTvaParDefaut('winbiz', poste(81))).toBe('N81');
    expect(codeTvaParDefaut('winbiz', poste(26))).toBe('R26');
    expect(codeTvaParDefaut('winbiz', poste(38))).toBe('H38');
  });

  it('CSV inchangé (taux lisible), autres cibles sans suggestion', () => {
    expect(codeTvaParDefaut('csv', poste(81))).toBe('8.1');
    expect(codeTvaParDefaut('csv', poste(26))).toBe('2.6');
    expect(codeTvaParDefaut('bexio', poste(81))).toBeNull();
  });
});
