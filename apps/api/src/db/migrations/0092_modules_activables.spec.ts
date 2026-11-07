/**
 * Garde structurelle de la migration 0092 (`tenant.modules_desactives`). La preuve sur vraie base
 * est `scripts/verifier-reversibilite-migrations.sh` (up/down/up) ; celle-ci verrouille, sans
 * Postgres, l'accord entre l'enum SQL et le contrat `MODULES_APP`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES_APP } from '@dfa/shared';
import { describe, expect, it } from 'vitest';

const MONTANTE = readFileSync(join(__dirname, '0092_modules_activables.sql'), 'utf8');
const DESCENDANTE = readFileSync(
  join(__dirname, 'down', '0092_modules_activables.down.sql'),
  'utf8',
);

describe('0092 — tenant.modules_desactives', () => {
  it('l’enum module_app porte exactement les modules du contrat, dans le même ordre', () => {
    const bloc = /create type public\.module_app as enum \(([^)]*)\);/.exec(MONTANTE);
    expect(bloc).not.toBeNull();
    const valeurs = [...(bloc?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(valeurs).toEqual([...MODULES_APP]);
  });

  it('ajoute un tableau NOT NULL vide par défaut (garages existants : tout actif)', () => {
    expect(MONTANTE).toMatch(
      /add column modules_desactives public\.module_app\[\] not null default '\{\}'/,
    );
  });

  it('la descendante retire la colonne avant le type', () => {
    expect(DESCENDANTE).toMatch(/drop column if exists modules_desactives/);
    expect(DESCENDANTE).toMatch(/drop type if exists public\.module_app/);
    expect(DESCENDANTE.indexOf('drop column')).toBeLessThan(DESCENDANTE.indexOf('drop type'));
  });
});
