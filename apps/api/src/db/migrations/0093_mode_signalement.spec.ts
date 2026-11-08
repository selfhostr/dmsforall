/**
 * Garde structurelle de la migration 0093 (`tenant.mode_signalement`). La preuve sur vraie base est
 * `scripts/verifier-reversibilite-migrations.sh` (up/down/up).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MONTANTE = readFileSync(join(__dirname, '0093_mode_signalement.sql'), 'utf8');
const DESCENDANTE = readFileSync(join(__dirname, 'down', '0093_mode_signalement.down.sql'), 'utf8');

describe('0093 — tenant.mode_signalement', () => {
  it('crée l’enum puis une colonne NOT NULL valant via_site par défaut', () => {
    expect(MONTANTE).toMatch(
      /create type public\.mode_signalement as enum \('via_site', 'copie_seule', 'desactive'\);/,
    );
    expect(MONTANTE).toMatch(
      /add column mode_signalement public\.mode_signalement not null default 'via_site';/,
    );
  });

  it('la descendante retire la colonne avant le type', () => {
    expect(DESCENDANTE).toMatch(/drop column if exists mode_signalement/);
    expect(DESCENDANTE).toMatch(/drop type if exists public\.mode_signalement/);
    expect(DESCENDANTE.indexOf('drop column')).toBeLessThan(DESCENDANTE.indexOf('drop type'));
  });
});
