/**
 * Garde structurelle de la migration 0097 (index « prénom nom »). La preuve sur vraie base est
 * `scripts/verifier-reversibilite-migrations.sh` (up/down/up).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MONTANTE = readFileSync(join(__dirname, '0097_client_recherche_prenom_nom.sql'), 'utf8');
const DESCENDANTE = readFileSync(
  join(__dirname, 'down', '0097_client_recherche_prenom_nom.down.sql'),
  'utf8',
);

describe('0097 — index trigram prénom nom', () => {
  it('pose un GIN tenant_id + trigramme sur une expression sans concat_ws', () => {
    expect(MONTANTE).toMatch(/create index client_recherche_prenom_nom_idx on public\.client/);
    expect(MONTANTE).toMatch(/gin_trgm_ops/);
    expect(MONTANTE.replace(/--.*$/gm, '')).not.toMatch(/concat_ws/);
  });

  it('la descendante supprime l’index', () => {
    expect(DESCENDANTE).toMatch(/drop index if exists public\.client_recherche_prenom_nom_idx/);
  });
});
