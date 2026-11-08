/**
 * Garde structurelle de la migration 0094 (devis accepte -> emis). La preuve sur vraie base est
 * `scripts/verifier-reversibilite-migrations.sh` (up/down/up) et le test d'intégration
 * `annuler-accord-devis.spec.ts`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MONTANTE = readFileSync(join(__dirname, '0094_annuler_accord_devis.sql'), 'utf8');
const DESCENDANTE = readFileSync(
  join(__dirname, 'down', '0094_annuler_accord_devis.down.sql'),
  'utf8',
);

describe('0094 — annuler l’accord d’un devis', () => {
  it('ajoute la seule transition devis accepte -> emis, sans motif', () => {
    expect(MONTANTE).toMatch(/values \('devis', 'accepte', 'emis', false\)/);
    expect(MONTANTE.match(/insert into/g)).toHaveLength(1);
  });
  it('la descendante supprime exactement cette transition', () => {
    expect(DESCENDANTE).toMatch(
      /type_document = 'devis' and statut_depuis = 'accepte' and statut_vers = 'emis'/,
    );
  });
});
