/**
 * Garde structurelle pour 0076 (validee -> realisee pour tous les types de ligne, sans pointage).
 * Statique, sans Postgres : la preuve en base est `test/lot1/machine-etats/transitions-ligne-or.spec.ts`
 * (suite d'intégration) et le rejeu up -> down -> up de la CI.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MONTANTE = readFileSync(join(__dirname, '0076_ligne_or_realisee_sans_pointage.sql'), 'utf8');
const DESCENDANTE = readFileSync(
  join(__dirname, 'down', '0076_ligne_or_realisee_sans_pointage.down.sql'),
  'utf8',
);

describe('0076 — validee -> realisee pour tous les types', () => {
  it("insère la transition générique (type_ligne = '*')", () => {
    expect(MONTANTE).toMatch(/\('ligne_or',\s*'validee',\s*'realisee',\s*false,\s*'\*'\)/);
  });

  it('retire les lignes type-spécifiques de 0046, devenues redondantes', () => {
    expect(MONTANTE).toMatch(/delete from public\.transition_autorisee[\s\S]*type_ligne <> '\*'/);
  });

  it('ne touche ni les fonctions, ni le trigger, ni la structure de transition_autorisee', () => {
    expect(MONTANTE).not.toMatch(/create (or replace )?function/i);
    expect(MONTANTE).not.toMatch(/alter table/i);
    expect(MONTANTE).not.toMatch(/drop /i);
  });

  it('le down restaure exactement les 7 types de 0046', () => {
    for (const type of [
      'piece',
      'fourniture',
      'produit_atelier',
      'taxe',
      'remise',
      'texte',
      'sous_traitance',
    ]) {
      expect(DESCENDANTE).toMatch(
        new RegExp(`\\('ligne_or',\\s*'validee',\\s*'realisee',\\s*false,\\s*'${type}'\\)`),
      );
    }
    expect(DESCENDANTE).toMatch(/delete from public\.transition_autorisee[\s\S]*type_ligne = '\*'/);
  });
});
