import { describe, expect, it } from 'vitest';

import type { LigneDocumentVente } from '../../db/schema';

import { syntheseDocuments } from './service-export-comptable';

function doc(
  typeDocument: 'facture' | 'avoir',
  exercice: number,
  numeroSequence: number,
  ht: bigint,
  tva: bigint,
): LigneDocumentVente {
  return {
    typeDocument,
    exercice,
    numeroSequence,
    numero: `${typeDocument === 'facture' ? 'F' : 'A'}-${String(exercice)}-${String(numeroSequence)}`,
    totalHtCentimes: ht,
    totalTvaCentimes: tva,
    totalTtcCentimes: ht + tva,
  } as unknown as LigneDocumentVente;
}

describe('syntheseDocuments', () => {
  it('aucun document : zéros et plages nulles', () => {
    expect(syntheseDocuments([])).toEqual({
      nbFactures: 0,
      nbAvoirs: 0,
      totalHtCentimes: 0n,
      totalTvaCentimes: 0n,
      totalTtcCentimes: 0n,
      facturePremier: null,
      factureDernier: null,
      avoirPremier: null,
      avoirDernier: null,
    });
  });

  it('un avoir (montants négatifs, MD-46) vient en déduction des totaux, valeurs exactes', () => {
    const s = syntheseDocuments([
      doc('facture', 2026, 3, 6475n, 525n),
      doc('facture', 2026, 1, 10000n, 810n),
      doc('avoir', 2026, 7, -6475n, -525n),
    ]);
    expect(s.nbFactures).toBe(2);
    expect(s.nbAvoirs).toBe(1);
    expect(s.totalHtCentimes).toBe(10000n);
    expect(s.totalTvaCentimes).toBe(810n);
    expect(s.totalTtcCentimes).toBe(10810n);
  });

  it('la plage suit la séquence, pas l’ordre de sélection, et ne mélange pas factures et avoirs', () => {
    const s = syntheseDocuments([
      doc('facture', 2026, 9, 1n, 0n),
      doc('facture', 2026, 4, 1n, 0n),
      doc('avoir', 2026, 2, -1n, 0n),
    ]);
    expect(s.facturePremier).toBe('F-2026-4');
    expect(s.factureDernier).toBe('F-2026-9');
    expect(s.avoirPremier).toBe('A-2026-2');
    expect(s.avoirDernier).toBe('A-2026-2');
  });

  it('un exercice plus récent l’emporte sur une séquence plus grande', () => {
    const s = syntheseDocuments([
      doc('facture', 2025, 900, 1n, 0n),
      doc('facture', 2026, 1, 1n, 0n),
    ]);
    expect(s.facturePremier).toBe('F-2025-900');
    expect(s.factureDernier).toBe('F-2026-1');
  });
});
