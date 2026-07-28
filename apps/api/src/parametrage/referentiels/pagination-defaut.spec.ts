import { describe, expect, it } from 'vitest';
import { decoderCurseurDefaut, pageDepuisLignes } from './pagination-defaut';

interface LigneTest {
  readonly id: string;
  readonly creeLe: Date;
}

// `decoderCurseurTrie` (common/pagination/curseur.ts) exige un `id` au format UUID — un curseur
// v2 ne peut pas encoder n'importe quelle chaîne. Les fixtures utilisent donc de vrais UUID
// plutôt que des lettres, faute de quoi le décodage échoue avec VALIDATION_ECHOUEE avant même
// d'atteindre l'assertion visée par ces tests.
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

function ligne(id: string, iso: string): LigneTest {
  return { id, creeLe: new Date(iso) };
}

describe('pageDepuisLignes', () => {
  it('moins de lignes que la limite : pas de suite, curseurSuivant null', () => {
    const lignes = [ligne(ID_A, '2026-01-01T00:00:00.000Z'), ligne(ID_B, '2026-01-02T00:00:00.000Z')];
    const { page, curseurSuivant } = pageDepuisLignes(lignes, 5);
    expect(page).toHaveLength(2);
    expect(curseurSuivant).toBeNull();
  });

  it('exactement limite + 1 lignes : tronque à la limite et rend un curseur', () => {
    const lignes = [
      ligne(ID_A, '2026-01-03T00:00:00.000Z'),
      ligne(ID_B, '2026-01-02T00:00:00.000Z'),
      ligne(ID_C, '2026-01-01T00:00:00.000Z'),
    ];
    const { page, curseurSuivant } = pageDepuisLignes(lignes, 2);
    expect(page.map((l) => l.id)).toEqual([ID_A, ID_B]);
    expect(curseurSuivant).not.toBeNull();
  });

  it('le curseur rendu se décode vers la clé du dernier élément de la page', () => {
    const lignes = [ligne(ID_A, '2026-01-03T00:00:00.000Z'), ligne(ID_B, '2026-01-02T00:00:00.000Z')];
    const { curseurSuivant } = pageDepuisLignes(lignes, 1);
    expect(curseurSuivant).not.toBeNull();
    const decode = decoderCurseurDefaut(curseurSuivant ?? undefined);
    expect(decode?.id).toBe(ID_A);
    expect(decode?.creeLe.toISOString()).toBe('2026-01-03T00:00:00.000Z');
  });
});

describe('decoderCurseurDefaut', () => {
  it('undefined -> null (première page)', () => {
    expect(decoderCurseurDefaut(undefined)).toBeNull();
  });

  it('curseur illisible -> VALIDATION_ECHOUEE', () => {
    expect(() => decoderCurseurDefaut('!!!pas-base64url-json!!!')).toThrow(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }),
    );
  });
});
