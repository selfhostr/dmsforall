import { describe, expect, it } from 'vitest';

import { dedupliquerLot } from './deduplication-lot-reprise';

describe('dedupliquerLot', () => {
  it('garde la PREMIÈRE occurrence par clé, écarte les suivantes', () => {
    const { retenus, ecartes } = dedupliquerLot([
      { cle: 'C-001', ligneSource: 0, donnees: 'premiere' },
      { cle: 'C-002', ligneSource: 1, donnees: 'autre-client' },
      { cle: 'C-001', ligneSource: 2, donnees: 'doublon-source' },
    ]);
    expect(retenus.map((r) => r.donnees)).toEqual(['premiere', 'autre-client']);
    expect(ecartes.map((e) => e.donnees)).toEqual(['doublon-source']);
  });

  it('aucun doublon -> tout retenu, rien écarté', () => {
    const { retenus, ecartes } = dedupliquerLot([
      { cle: 'A', ligneSource: 0, donnees: 1 },
      { cle: 'B', ligneSource: 1, donnees: 2 },
    ]);
    expect(retenus).toHaveLength(2);
    expect(ecartes).toHaveLength(0);
  });

  it('lot vide -> résultat vide des deux côtés', () => {
    const { retenus, ecartes } = dedupliquerLot([]);
    expect(retenus).toEqual([]);
    expect(ecartes).toEqual([]);
  });

  it('trois occurrences de la même clé -> une retenue, deux écartées (jamais un doublon qui en cache un autre)', () => {
    const { retenus, ecartes } = dedupliquerLot([
      { cle: 'X', ligneSource: 0, donnees: 'a' },
      { cle: 'X', ligneSource: 1, donnees: 'b' },
      { cle: 'X', ligneSource: 2, donnees: 'c' },
    ]);
    expect(retenus).toHaveLength(1);
    expect(ecartes).toHaveLength(2);
    expect(ecartes.map((e) => e.ligneSource)).toEqual([1, 2]);
  });
});
