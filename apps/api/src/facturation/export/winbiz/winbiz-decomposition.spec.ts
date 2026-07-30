import { describe, expect, it } from 'vitest';

import type { EcritureExport, LigneEcritureExport } from '@dfa/shared';

import { decomposerEcritureWinbiz } from './winbiz-decomposition';
import { ErreurExportWinbiz } from './winbiz.erreurs';

function ligne(partiel: Partial<LigneEcritureExport> & Pick<LigneEcritureExport, 'compte' | 'sens' | 'montantCentimes'>): LigneEcritureExport {
  return {
    codeTva: null,
    tauxPourmille: null,
    baseTvaCentimes: null,
    libelle: '',
    ...partiel,
  };
}

function ecriture(partiel: Partial<EcritureExport> & Pick<EcritureExport, 'lignes'>): EcritureExport {
  return {
    reference: 'FA-2026-00123',
    date: '2026-07-29',
    libelle: 'Facture 2026-00123',
    centreDeCharge: null,
    documentId: 'doc-1',
    ...partiel,
  };
}

describe('decomposerEcritureWinbiz — cas 1×1 (paiement simple)', () => {
  it('produit une ligne WinBIZ directe, sans bloc TVA', () => {
    const e = ecriture({
      lignes: [
        ligne({ compte: '1020', sens: 'debit', montantCentimes: 150000, libelle: 'Encaissement CB' }),
        ligne({ compte: '1100', sens: 'credit', montantCentimes: 150000, libelle: 'Débiteurs' }),
      ],
    });

    const resultat = decomposerEcritureWinbiz(e);

    expect(resultat).toHaveLength(1);
    expect(resultat[0]).toMatchObject({
      compteDebit: '1020',
      compteCredit: '1100',
      montantCentimes: 150000,
      ligneTva: null,
    });
  });

  it('refuse un débit ≠ crédit (garde-fou défensif — ne devrait jamais survenir en amont)', () => {
    const e = ecriture({
      lignes: [
        ligne({ compte: '1020', sens: 'debit', montantCentimes: 150000 }),
        ligne({ compte: '1100', sens: 'credit', montantCentimes: 150001 }),
      ],
    });

    expect(() => decomposerEcritureWinbiz(e)).toThrow(ErreurExportWinbiz);
    try {
      decomposerEcritureWinbiz(e);
    } catch (err) {
      expect((err as ErreurExportWinbiz).code).toBe('ECRITURE_DESEQUILIBREE');
    }
  });

  it('refuse deux codes TVA différents sur les deux lignes du cas 1×1', () => {
    const e = ecriture({
      lignes: [
        ligne({ compte: '1170', sens: 'debit', montantCentimes: 500, codeTva: 'TVA_A', tauxPourmille: 81 }),
        ligne({ compte: '1171', sens: 'credit', montantCentimes: 500, codeTva: 'TVA_B', tauxPourmille: 26 }),
      ],
    });

    expect(() => decomposerEcritureWinbiz(e)).toThrow(ErreurExportWinbiz);
    try {
      decomposerEcritureWinbiz(e);
    } catch (err) {
      expect((err as ErreurExportWinbiz).code).toBe('LIGNES_TVA_CONFLIT');
    }
  });
});

describe('decomposerEcritureWinbiz — cas 1×N (facture : débiteurs ▸ {produit, TVA due})', () => {
  // TTC 108.10 = HT 100.00 + TVA 8.10 (taux normal 8.1%, 81‰).
  const facture = ecriture({
    lignes: [
      ligne({ compte: '1100', sens: 'debit', montantCentimes: 10810, libelle: 'Débiteurs' }),
      ligne({
        compte: '3200',
        sens: 'credit',
        montantCentimes: 10000,
        libelle: 'Vente main-d’œuvre',
      }),
      ligne({
        compte: '1170',
        sens: 'credit',
        montantCentimes: 810,
        codeTva: 'V81',
        tauxPourmille: 81,
        baseTvaCentimes: 10000,
        libelle: 'TVA due 8.1%',
      }),
    ],
  });

  it('décompose en exactement deux lignes WinBIZ, montants EXACTS, aucun recalcul', () => {
    const resultat = decomposerEcritureWinbiz(facture);
    expect(resultat).toHaveLength(2);

    const ligneProduit = resultat.find((l) => l.compteCredit === '3200');
    const ligneTva = resultat.find((l) => l.compteCredit === '1170');

    expect(ligneProduit).toMatchObject({ compteDebit: '1100', compteCredit: '3200', montantCentimes: 10000, ligneTva: null });
    expect(ligneTva).toBeDefined();
    expect(ligneTva).toMatchObject({ compteDebit: '1100', compteCredit: '1170', montantCentimes: 810 });
    expect(ligneTva?.ligneTva?.codeTva).toBe('V81');
    expect(ligneTva?.ligneTva?.tauxPourmille).toBe(81);

    // Équilibre : la somme des lignes non-pivot vaut EXACTEMENT le pivot.
    const total = resultat.reduce((s, l) => s + l.montantCentimes, 0);
    expect(total).toBe(10810);
  });

  it('refuse une somme des lignes non-pivot ≠ montant du pivot', () => {
    const cassee = ecriture({
      lignes: [
        ligne({ compte: '1100', sens: 'debit', montantCentimes: 10810 }),
        ligne({ compte: '3200', sens: 'credit', montantCentimes: 9999 }),
        ligne({ compte: '1170', sens: 'credit', montantCentimes: 810, codeTva: 'V81', tauxPourmille: 81 }),
      ],
    });
    expect(() => decomposerEcritureWinbiz(cassee)).toThrow(ErreurExportWinbiz);
  });

  it('refuse si la ligne pivot porte elle-même un code TVA', () => {
    const pivotAvecTva = ecriture({
      lignes: [
        ligne({ compte: '1100', sens: 'debit', montantCentimes: 10810, codeTva: 'X', tauxPourmille: 81 }),
        ligne({ compte: '3200', sens: 'credit', montantCentimes: 10000 }),
        ligne({ compte: '1170', sens: 'credit', montantCentimes: 810 }),
      ],
    });
    expect(() => decomposerEcritureWinbiz(pivotAvecTva)).toThrow(ErreurExportWinbiz);
    try {
      decomposerEcritureWinbiz(pivotAvecTva);
    } catch (err) {
      expect((err as ErreurExportWinbiz).code).toBe('LIGNE_PIVOT_PORTE_TVA');
    }
  });
});

describe('decomposerEcritureWinbiz — cas N×1 (avoir : {produit, TVA due} ▸ débiteurs)', () => {
  it('décompose symétriquement au cas facture', () => {
    const avoir = ecriture({
      reference: 'AV-2026-00004',
      lignes: [
        ligne({ compte: '3200', sens: 'debit', montantCentimes: 10000 }),
        ligne({ compte: '1170', sens: 'debit', montantCentimes: 810, codeTva: 'V81', tauxPourmille: 81 }),
        ligne({ compte: '1100', sens: 'credit', montantCentimes: 10810 }),
      ],
    });

    const resultat = decomposerEcritureWinbiz(avoir);
    expect(resultat).toHaveLength(2);
    for (const l of resultat) {
      expect(l.compteCredit).toBe('1100');
    }
    const total = resultat.reduce((s, l) => s + l.montantCentimes, 0);
    expect(total).toBe(10810);
  });
});

describe('decomposerEcritureWinbiz — cas N×M refusé (pas d’appariement canonique)', () => {
  it('refuse deux lignes des deux côtés', () => {
    const nm = ecriture({
      lignes: [
        ligne({ compte: '1100', sens: 'debit', montantCentimes: 5000 }),
        ligne({ compte: '1101', sens: 'debit', montantCentimes: 5000 }),
        ligne({ compte: '3200', sens: 'credit', montantCentimes: 5000 }),
        ligne({ compte: '3201', sens: 'credit', montantCentimes: 5000 }),
      ],
    });
    expect(() => decomposerEcritureWinbiz(nm)).toThrow(ErreurExportWinbiz);
    try {
      decomposerEcritureWinbiz(nm);
    } catch (err) {
      expect((err as ErreurExportWinbiz).code).toBe('ECRITURE_NON_DECOMPOSABLE');
    }
  });
});

describe('decomposerEcritureWinbiz — cas dégénérés', () => {
  it('refuse une écriture sans lignes', () => {
    const vide = ecriture({ lignes: [] });
    expect(() => decomposerEcritureWinbiz(vide)).toThrow(ErreurExportWinbiz);
  });

  it('refuse une écriture sans aucune ligne débit (ou sans aucune ligne crédit)', () => {
    const sansCrEdit = ecriture({
      lignes: [ligne({ compte: '1100', sens: 'debit', montantCentimes: 100 })],
    });
    expect(() => decomposerEcritureWinbiz(sansCrEdit)).toThrow(ErreurExportWinbiz);
  });
});
