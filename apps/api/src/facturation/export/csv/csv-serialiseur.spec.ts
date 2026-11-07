import { describe, expect, it } from 'vitest';
import type { EcritureExport } from '@dfa/shared';

import {
  BOM_UTF8,
  echapperChampTexte,
  ENTETES_CSV_FIDUCIAIRE,
  formaterDateCsv,
  formaterMontantCsv,
  formaterTauxCsv,
  serialiserEcrituresCsv,
} from './csv-serialiseur';

const FACTURE: EcritureExport = {
  reference: 'F-000123',
  date: '2026-07-15',
  libelle: 'Facture F-000123',
  centreDeCharge: null,
  documentId: 'doc-1',
  lignes: [
    {
      compte: '1100',
      sens: 'debit',
      montantCentimes: 108100,
      codeTva: null,
      tauxPourmille: null,
      baseTvaCentimes: null,
      libelle: 'Créances — Garage Dupont',
    },
    {
      compte: '3400',
      sens: 'credit',
      montantCentimes: 100000,
      codeTva: null,
      tauxPourmille: null,
      baseTvaCentimes: null,
      libelle: 'main_oeuvre_bareme — F-000123',
    },
    {
      compte: '2200',
      sens: 'credit',
      montantCentimes: 8100,
      codeTva: 'N81',
      tauxPourmille: 81,
      baseTvaCentimes: 100000,
      libelle: 'TVA due 8.1% — F-000123',
    },
  ],
};

function lire(contenu: Buffer): string[] {
  return contenu.subarray(BOM_UTF8.length).toString('utf8').split('\r\n');
}

describe('serialiserEcrituresCsv', () => {
  it('commence par le BOM UTF-8 puis les en-têtes français séparés par ;', () => {
    const lot = serialiserEcrituresCsv([FACTURE], new Map(), 'x.csv');
    expect(lot.contenu.subarray(0, 3)).toEqual(BOM_UTF8);
    expect(lire(lot.contenu)[0]).toBe(ENTETES_CSV_FIDUCIAIRE.join(';'));
    expect(lire(lot.contenu)[0]).toBe(
      'Date;Pièce;Compte débit;Compte crédit;Libellé;Montant CHF;Code TVA;Taux TVA %;Base TVA CHF;Montant TVA CHF;Numéro de document;Client',
    );
  });

  it('une facture 1 débit × 2 crédits donne deux lignes, montants exacts, TVA sur la ligne de TVA seulement', () => {
    const lot = serialiserEcrituresCsv(
      [FACTURE],
      new Map([['F-000123', 'Garage Dupont']]),
      'x.csv',
    );
    const l = lire(lot.contenu);
    expect(l[1]).toBe(
      '15.07.2026;F-000123;1100;3400;main_oeuvre_bareme — F-000123;1000.00;;;;;F-000123;Garage Dupont',
    );
    expect(l[2]).toBe(
      '15.07.2026;F-000123;1100;2200;TVA due 8.1% — F-000123;81.00;N81;8.1;1000.00;81.00;F-000123;Garage Dupont',
    );
    expect(lot.nbLignesCsv).toBe(3);
    expect(lot.nbEcritures).toBe(1);
    expect(lot.totalDebitCentimes).toBe(108100n);
    expect(lot.totalCreditCentimes).toBe(108100n);
  });

  it('un avoir inverse les comptes et garde des montants positifs', () => {
    const avoir: EcritureExport = {
      ...FACTURE,
      reference: 'A-000005',
      lignes: [
        { ...FACTURE.lignes[0]!, sens: 'credit' },
        { ...FACTURE.lignes[1]!, sens: 'debit' },
        { ...FACTURE.lignes[2]!, sens: 'debit' },
      ],
    };
    const l = lire(serialiserEcrituresCsv([avoir], new Map(), 'x.csv').contenu);
    expect(l[1]).toContain(';3400;1100;');
    expect(l[1]).toContain(';1000.00;');
    expect(l[1]).not.toContain(';-');
  });

  it('une écriture de paiement (documentId null) laisse « Numéro de document » vide', () => {
    const paiement: EcritureExport = {
      reference: '0b6f6e3c-0000-4000-8000-000000000001',
      date: '2026-07-20',
      libelle: 'Encaissement',
      centreDeCharge: null,
      documentId: null,
      lignes: [
        {
          compte: '1020',
          sens: 'debit',
          montantCentimes: 5000,
          codeTva: null,
          tauxPourmille: null,
          baseTvaCentimes: null,
          libelle: 'Banque',
        },
        {
          compte: '1100',
          sens: 'credit',
          montantCentimes: 5000,
          codeTva: null,
          tauxPourmille: null,
          baseTvaCentimes: null,
          libelle: 'Créances — F-000123',
        },
      ],
    };
    const l = lire(serialiserEcrituresCsv([paiement], new Map(), 'x.csv').contenu);
    expect(l[1]).toBe(
      '20.07.2026;0b6f6e3c-0000-4000-8000-000000000001;1020;1100;Banque;50.00;;;;;;',
    );
  });

  it('neutralise une formule dans le nom du client et protège ; et guillemets', () => {
    const lot = serialiserEcrituresCsv(
      [FACTURE],
      new Map([['F-000123', '=HYPERLINK("http://x";"a")']]),
      'x.csv',
    );
    const ligne = lire(lot.contenu)[1] ?? '';
    expect(ligne.endsWith(`"'=HYPERLINK(""http://x"";""a"")"`)).toBe(true);
  });

  it('empreinte = SHA-256 du contenu, déterministe', () => {
    const a = serialiserEcrituresCsv([FACTURE], new Map(), 'x.csv');
    const b = serialiserEcrituresCsv([FACTURE], new Map(), 'x.csv');
    expect(a.empreinteSha256).toBe(b.empreinteSha256);
    expect(a.empreinteSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('formats CSV', () => {
  it('montants en centimes exacts, jamais de flottant', () => {
    expect(formaterMontantCsv(0)).toBe('0.00');
    expect(formaterMontantCsv(5)).toBe('0.05');
    expect(formaterMontantCsv(123456)).toBe('1234.56');
    expect(formaterMontantCsv(-1005)).toBe('-10.05');
    expect(() => formaterMontantCsv(1.5)).toThrow();
  });
  it('dates jj.mm.aaaa et refus d’un format inattendu', () => {
    expect(formaterDateCsv('2026-01-02')).toBe('02.01.2026');
    expect(() => formaterDateCsv('02.01.2026')).toThrow();
  });
  it('taux 81 → 8.1, 26 → 2.6, 38 → 3.8', () => {
    expect(formaterTauxCsv(81)).toBe('8.1');
    expect(formaterTauxCsv(26)).toBe('2.6');
    expect(formaterTauxCsv(38)).toBe('3.8');
  });
  it('échappement', () => {
    expect(echapperChampTexte('simple')).toBe('simple');
    expect(echapperChampTexte('a;b')).toBe('"a;b"');
    expect(echapperChampTexte('+41 79')).toBe("'+41 79");
    expect(echapperChampTexte('dit "oui"')).toBe('"dit ""oui"""');
  });
});
