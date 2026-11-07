import { describe, expect, it } from 'vitest';

import type { ElementBloquant } from '@dfa/shared';

import { estCodePrerequis, prerequisDepuisBlocages } from './prerequis';

const b = (donnees: Record<string, unknown>, libelle = 'x'): ElementBloquant => ({
  type: 'champ',
  id: 'i',
  libelle,
  donnees,
});

describe('prerequisDepuisBlocages', () => {
  it('regroupe les trous par type et exercice', () => {
    const r = prerequisDepuisBlocages('EXPORT_TROU_NUMEROTATION', [
      b({ numero: 'F-1', typeDocument: 'facture', exercice: 2026 }),
      b({ numero: 'F-2', typeDocument: 'facture', exercice: 2026 }),
      b({ numero: 'A-1', typeDocument: 'avoir', exercice: 2026 }),
    ]);
    expect(r).toEqual({
      code: 'EXPORT_TROU_NUMEROTATION',
      trous: [
        { typeDocument: 'facture', exercice: 2026, numeros: ['F-1', 'F-2'] },
        { typeDocument: 'avoir', exercice: 2026, numeros: ['A-1'] },
      ],
    });
  });

  it('sépare comptes et codes TVA du mapping', () => {
    const r = prerequisDepuisBlocages('EXPORT_MAPPING_INCOMPLET', [
      b({ poste: 'compte', usage: 'produit', categorie: 'piece', references: ['F-1'] }),
      b({ poste: 'code_tva', regimeTva: 'normal', tauxPourmille: 81, references: [] }),
    ]);
    expect(r).toEqual({
      code: 'EXPORT_MAPPING_INCOMPLET',
      comptes: [{ usage: 'produit', categorie: 'piece', references: ['F-1'] }],
      codesTva: [{ regimeTva: 'normal', tauxPourmille: 81, references: [] }],
    });
  });

  it('lit les déséquilibres en centimes exacts', () => {
    expect(
      prerequisDepuisBlocages('EXPORT_ECRITURES_DESEQUILIBREES', [
        b({ reference: 'F-1', totalDebitCentimes: 10000, totalCreditCentimes: 9995 }),
      ]),
    ).toEqual({
      code: 'EXPORT_ECRITURES_DESEQUILIBREES',
      ecritures: [{ reference: 'F-1', totalDebitCentimes: 10000, totalCreditCentimes: 9995 }],
    });
  });

  it('rend undefined quand les données ne sont pas exploitables', () => {
    expect(prerequisDepuisBlocages('EXPORT_TROU_NUMEROTATION', [b({})])).toBeUndefined();
    expect(prerequisDepuisBlocages('EXPORT_MAPPING_INCOMPLET', [])).toBeUndefined();
  });

  it('reconnaît les codes de prérequis', () => {
    expect(estCodePrerequis('EXPORT_TROU_NUMEROTATION')).toBe(true);
    expect(estCodePrerequis('AUTRE')).toBe(false);
    expect(estCodePrerequis(undefined)).toBe(false);
  });
});
