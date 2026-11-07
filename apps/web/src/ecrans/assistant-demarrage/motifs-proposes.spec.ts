import { describe, expect, it } from 'vitest';

import { MOTIFS_PROPOSES, motifsACreer } from './motifs-proposes';

describe('motifs proposés', () => {
  it('huit motifs, codes valides pour le contrat, libellés dans les trois langues', () => {
    expect(MOTIFS_PROPOSES).toHaveLength(8);
    for (const m of MOTIFS_PROPOSES) {
      expect(m.code).toMatch(/^[A-Z0-9][A-Z0-9_-]{0,39}$/);
      expect(m.libelle.fr && m.libelle.de && m.libelle.it).toBeTruthy();
    }
    expect(new Set(MOTIFS_PROPOSES.map((m) => m.code)).size).toBe(8);
  });
  it('ne crée que les motifs cochés et absents', () => {
    const creer = motifsACreer(new Set(['SERVICE', 'PNEUS', 'DEVIS']), new Set(['PNEUS']));
    expect(creer.map((m) => m.code)).toEqual(['SERVICE', 'DEVIS']);
    expect(motifsACreer(new Set(), new Set())).toEqual([]);
  });
});
