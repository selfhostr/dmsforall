import { describe, expect, it } from 'vitest';

import { ErreurEcritureDesequilibree } from '../ecritures/erreur-desequilibre';
import {
  blocagesMapping,
  blocagesTrous,
  DIAGNOSTIC_VIDE,
  MAX_BLOCAGES,
  regrouperManquants,
  versPrerequis,
} from './prerequis-export';

describe('regrouperManquants', () => {
  it('regroupe par poste et cite chaque pièce une seule fois', () => {
    const r = regrouperManquants([
      { type: 'compte', usage: 'produit', categorie: 'piece', documentNumero: 'F-1' },
      { type: 'compte', usage: 'produit', categorie: 'piece', documentNumero: 'F-2' },
      { type: 'compte', usage: 'produit', categorie: 'piece', documentNumero: 'F-1' },
      { type: 'code_tva', regimeTva: 'normal', tauxPourmille: 81, documentNumero: 'F-1' },
    ]);
    expect(r.comptes).toEqual([
      { usage: 'produit', categorie: 'piece', references: ['F-1', 'F-2'] },
    ]);
    expect(r.codesTva).toEqual([{ regimeTva: 'normal', tauxPourmille: 81, references: ['F-1'] }]);
  });
});

describe('versPrerequis', () => {
  it('rien ne manque : aucun prérequis', () => {
    expect(versPrerequis(DIAGNOSTIC_VIDE)).toEqual([]);
  });

  it('liste les quatre familles sans s’arrêter à la première', () => {
    const p = versPrerequis({
      trous: [{ typeDocument: 'facture', exercice: 2026, documents: [{ id: 'd', numero: 'F-3' }] }],
      manquants: [
        { type: 'compte', usage: 'creances_clients', categorie: 'defaut', documentNumero: 'F-4' },
      ],
      desequilibres: [
        new ErreurEcritureDesequilibree('x', {
          reference: 'F-5',
          documentId: 'd5',
          totalDebitCentimes: 100n,
          totalCreditCentimes: 90n,
        }),
      ],
      limites: [
        {
          type: 'compensation_non_supportee',
          paiementId: 'p',
          documentId: 'd',
          documentNumero: 'FA-1',
        },
      ],
    });
    expect(p.map((x) => x.code)).toEqual([
      'EXPORT_TROU_NUMEROTATION',
      'EXPORT_MAPPING_INCOMPLET',
      'EXPORT_ECRITURES_DESEQUILIBREES',
      'FONCTION_NON_DISPONIBLE',
    ]);
    expect(p[0]).toEqual({
      code: 'EXPORT_TROU_NUMEROTATION',
      trous: [{ typeDocument: 'facture', exercice: 2026, numeros: ['F-3'] }],
    });
    expect(p[2]).toEqual({
      code: 'EXPORT_ECRITURES_DESEQUILIBREES',
      ecritures: [
        { reference: 'F-5', pieces: [], totalDebitCentimes: 100, totalCreditCentimes: 90 },
      ],
    });
  });
});

describe('blocages bornés', () => {
  it('au plus 50 éléments, donnees.total porte le compte réel', () => {
    const docs = Array.from({ length: 60 }, (_, i) => ({
      id: `d${String(i)}`,
      numero: `F-${String(i)}`,
    }));
    const b = blocagesTrous([{ typeDocument: 'facture', exercice: 2026, documents: docs }]);
    expect(b).toHaveLength(MAX_BLOCAGES);
    expect(b[0]?.donnees?.total).toBe(60);
  });

  it('un compte et un code TVA manquants donnent deux blocages distincts', () => {
    const b = blocagesMapping([
      { type: 'compte', usage: 'tva_due', categorie: '81', documentNumero: 'F-1' },
      { type: 'code_tva', regimeTva: 'normal', tauxPourmille: 81, documentNumero: 'F-1' },
    ]);
    expect(b.map((x) => x.id)).toEqual(['compte:tva_due:81', 'code_tva:normal:81']);
  });
});
