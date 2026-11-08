/**
 * Garde structurelle de la migration 0090 (`tenant.assujetti_tva`). La preuve sur vraie base est
 * `scripts/verifier-reversibilite-migrations.sh` (up/down/up) et le test d'intégration
 * `test/integration/assujetti-tva.integration.spec.ts` ; celle-ci verrouille, sans Postgres, les
 * choix documentés dans l'en-tête SQL.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MONTANTE = readFileSync(join(__dirname, '0090_assujetti_tva.sql'), 'utf8');
const DESCENDANTE = readFileSync(join(__dirname, 'down', '0090_assujetti_tva.down.sql'), 'utf8');

describe('0090 — tenant.assujetti_tva', () => {
  it('ajoute une colonne booléenne NOT NULL, `true` par défaut (garages existants inchangés)', () => {
    expect(MONTANTE).toMatch(
      /alter table public\.tenant add column assujetti_tva boolean not null default true;/,
    );
  });

  it('garantit en base qu’un non-assujetti n’a pas de n° TVA, et rien de plus', () => {
    expect(MONTANTE).toMatch(/check \(assujetti_tva or numero_tva is null\)/);
    // « assujetti ⇒ n° obligatoire » n'est PAS en base : c'est l'émission qui l'exige.
    expect(MONTANTE).not.toMatch(/check \(not assujetti_tva or numero_tva is not null\)/);
  });

  it('la descendante retire la contrainte puis la colonne', () => {
    expect(DESCENDANTE).toMatch(
      /drop constraint if exists tenant_non_assujetti_sans_numero_tva_chk/,
    );
    expect(DESCENDANTE).toMatch(/drop column if exists assujetti_tva/);
    expect(DESCENDANTE.indexOf('drop constraint')).toBeLessThan(DESCENDANTE.indexOf('drop column'));
  });
});
