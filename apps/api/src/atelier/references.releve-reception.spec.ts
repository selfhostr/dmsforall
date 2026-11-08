import { describe, expect, it, vi } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../db';
import { enregistrerReleveReception } from './references';

const ctx = { tenantId: 't1', utilisateurId: 'u1' } as unknown as ContexteTenant;

/** Faux `tx` : chaque `select().from().where()...limit()` rend les lignes suivantes de `lectures`. */
function fabriquerTx(lectures: readonly (readonly object[])[]) {
  const file = [...lectures];
  const valeursInserees: object[] = [];
  const requete = () => {
    const chaine: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy']) chaine[m] = () => chaine;
    chaine['limit'] = () => Promise.resolve(file.shift() ?? []);
    return chaine;
  };
  const tx = {
    select: vi.fn(requete),
    insert: vi.fn(() => ({
      values: (v: object) => {
        valeursInserees.push(v);
        return Promise.resolve();
      },
    })),
  };
  return { tx: tx as unknown as TransactionDfa, valeursInserees };
}

const params = {
  vehiculeId: 'v1',
  orId: 'or1',
  valeur: 84500,
  unite: 'km' as const,
  valeurKm: 84500,
  releveLe: new Date('2026-11-07T08:00:00Z'),
  saisiParId: 'u1',
};

describe('enregistrerReleveReception', () => {
  it("écrit le relevé « reception » du kilométrage d'entrée quand rien n'existe", async () => {
    const { tx, valeursInserees } = fabriquerTx([[], []]);
    expect(await enregistrerReleveReception(tx, ctx, params)).toBe(true);
    expect(valeursInserees).toEqual([
      expect.objectContaining({
        tenantId: 't1',
        vehiculeId: 'v1',
        valeur: 84500,
        source: 'reception',
        ordreReparationId: 'or1',
        motifRegression: null,
      }),
    ]);
  });

  it('est idempotent : un relevé de réception existe déjà pour cet OR', async () => {
    const { tx, valeursInserees } = fabriquerTx([[{ id: 'k1' }]]);
    expect(await enregistrerReleveReception(tx, ctx, params)).toBe(false);
    expect(valeursInserees).toEqual([]);
  });

  it("n'inscrit pas un kilométrage inférieur au dernier relevé", async () => {
    const { tx, valeursInserees } = fabriquerTx([[], [{ valeurKm: 90000 }]]);
    expect(await enregistrerReleveReception(tx, ctx, params)).toBe(false);
    expect(valeursInserees).toEqual([]);
  });
});
