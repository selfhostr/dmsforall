import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  codeSiteParDefaut,
  MOTIFS_RENDEZ_VOUS_PAR_DEFAUT,
  TAUX_HORAIRE_ATELIER_DEFAUT,
} from './defauts-garage';

const MIGRATION = readFileSync(
  resolve(__dirname, '../db/migrations/0079_garage_neuf_defauts.sql'),
  'utf8',
);

describe('défauts du garage neuf', () => {
  it('huit motifs aux codes uniques, durées strictement positives', () => {
    const codes = MOTIFS_RENDEZ_VOUS_PAR_DEFAUT.map((m) => m.code);
    expect(codes).toEqual([
      'SERVICE',
      'PNEUS',
      'EXPERTISE-MFK',
      'FREINS',
      'DIAGNOSTIC',
      'CARROSSERIE',
      'CLIMATISATION',
      'AUTRE',
    ]);
    expect(new Set(codes).size).toBe(codes.length);
    for (const m of MOTIFS_RENDEZ_VOUS_PAR_DEFAUT) {
      expect(m.dureeDefautMinutes).toBeGreaterThan(0);
      expect(m.code).toMatch(/^[A-Z0-9][A-Z0-9_-]{0,39}$/);
    }
  });

  it('taux horaire : montant entier en centimes', () => {
    expect(TAUX_HORAIRE_ATELIER_DEFAUT.montantCentimes).toBe(14000);
    expect(Number.isInteger(TAUX_HORAIRE_ATELIER_DEFAUT.montantCentimes)).toBe(true);
  });

  it('la migration 0079 reste alignée avec ces constantes (motifs, durées, taux)', () => {
    for (const m of MOTIFS_RENDEZ_VOUS_PAR_DEFAUT) {
      const sql = (s: string): string => s.replace(/'/g, "''");
      expect(MIGRATION).toContain(
        `('${m.code}', '${sql(m.libelleFr)}', '${sql(m.libelleDe)}', '${sql(m.libelleIt)}', ${String(m.dureeDefautMinutes)})`,
      );
    }
    expect(MIGRATION).toContain(
      `'${TAUX_HORAIRE_ATELIER_DEFAUT.code}', '${TAUX_HORAIRE_ATELIER_DEFAUT.libelle}', ${String(TAUX_HORAIRE_ATELIER_DEFAUT.montantCentimes)}, date '${TAUX_HORAIRE_ATELIER_DEFAUT.valideDu}'`,
    );
  });

  it('code de site : slug en majuscules, tronqué sans tiret final', () => {
    expect(codeSiteParDefaut('garage-exemple')).toBe('GARAGE-EXEMPLE');
    expect(codeSiteParDefaut('a'.repeat(23) + '-bbbbbbbb')).toBe('A'.repeat(23));
  });
});
