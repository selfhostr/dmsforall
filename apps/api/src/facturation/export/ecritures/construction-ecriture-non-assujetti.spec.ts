import { describe, expect, it } from 'vitest';

import type {
  LigneDocumentVente,
  LigneDocumentVenteTva,
  LigneLigneDocument,
} from '../../../db/schema';
import { serialiserEcrituresCsv } from '../csv/csv-serialiseur';
import { serialiserEcrituresWinbiz } from '../winbiz/winbiz-serialiseur';
import { ComptesResolusADate, indexerCodesTva, indexerComptes } from './comptes-resolus';
import { construireEcritureDocument } from './construction-ecriture';

/**
 * Export fiduciaire d'une facture de garage NON assujetti à la TVA (migration 0090) : lignes à
 * 0 ‰, régime `exclu`, HT = TTC. Preuve que l'écriture reste équilibrée SANS ligne TVA, sans compte
 * `tva_due` ni code TVA au mapping, et que WinBIZ et le CSV générique l'acceptent.
 *
 * Cas chiffré : 1 vidange à CHF 216.20 + 1 pièce à CHF 50.05, aucune TVA → créances 266.25 au débit,
 * produits 216.20 + 50.05 au crédit.
 */

const doc = {
  id: 'doc-nt',
  tenantId: 'tenant-1',
  typeDocument: 'facture',
  numero: '2026-00042',
  dateDocument: '2026-11-02',
  clientDesignationFigee: 'Jean Dupont',
  totalHtCentimes: 26_625n,
  totalTvaCentimes: 0n,
  totalTtcCentimes: 26_625n,
} as unknown as LigneDocumentVente;

const lignes = [
  {
    id: 'l1',
    numeroOrdre: 1,
    typeLigne: 'forfait',
    categorieComptable: null,
    regimeTva: 'exclu',
    tauxTvaPourmille: 0,
    htCentimes: 21_620,
    tvaCentimes: 0,
    ttcCentimes: 21_620,
  },
  {
    id: 'l2',
    numeroOrdre: 2,
    typeLigne: 'piece',
    categorieComptable: null,
    regimeTva: 'exclu',
    tauxTvaPourmille: 0,
    htCentimes: 5_005,
    tvaCentimes: 0,
    ttcCentimes: 5_005,
  },
] as unknown as LigneLigneDocument[];

const ventilation = [
  { regimeTva: 'exclu', tauxTvaPourmille: 0, baseCentimes: 26_625, tvaCentimes: 0 },
] as unknown as LigneDocumentVenteTva[];

/** Plan minimal : AUCUN compte `tva_due`, AUCUN code TVA — un non-assujetti n'en a pas. */
const comptes = new ComptesResolusADate(
  indexerComptes([
    { usage: 'creances_clients', categorie: 'defaut', compte: '1100' },
    { usage: 'produit', categorie: 'forfait', compte: '3400' },
    { usage: 'produit', categorie: 'piece', compte: '3200' },
  ]),
  indexerCodesTva([]),
);

describe('écriture d’une facture de non-assujetti', () => {
  const resultat = construireEcritureDocument(doc, lignes, ventilation, comptes, null);

  it('est équilibrée à 26’625 ct sans aucune ligne TVA ni mapping TVA manquant', () => {
    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(26_625n);
    expect(resultat.totalCreditCentimes).toBe(26_625n);
    expect(resultat.ecriture.lignes.map((l) => [l.compte, l.sens, l.montantCentimes])).toEqual([
      ['1100', 'debit', 26_625],
      ['3400', 'credit', 21_620],
      ['3200', 'credit', 5_005],
    ]);
    expect(resultat.ecriture.lignes.every((l) => l.codeTva === null)).toBe(true);
  });

  it('WinBIZ accepte l’écriture : 2 lignes, 266.25 débité = 266.25 crédité, pas de code TVA', () => {
    if (!resultat.succes) throw new Error('écriture attendue');
    const lot = serialiserEcrituresWinbiz([resultat.ecriture]);
    expect(lot.nbEcritures).toBe(1);
    expect(lot.nbLignesCsv).toBe(2);
    expect(lot.totalDebitCentimes).toBe(26_625n);
    expect(lot.totalCreditCentimes).toBe(26_625n);
    expect(lot.avertissements).toEqual([]);
  });

  it('CSV générique accepte l’écriture : colonnes TVA vides, montants exacts', () => {
    if (!resultat.succes) throw new Error('écriture attendue');
    const lot = serialiserEcrituresCsv([resultat.ecriture], new Map(), 'export.csv');
    expect(lot.totalDebitCentimes).toBe(26_625n);
    const texte = lot.contenu.toString('utf8').split(/\r?\n/);
    // En-tête + 2 lignes de données (créances → forfait 216.20, créances → pièce 50.05).
    expect(texte.filter((l) => l !== '')).toHaveLength(3);
    expect(texte).toContain(
      '02.11.2026;2026-00042;1100;3200;piece — 2026-00042;50.05;;;;;2026-00042;',
    );
    expect(texte).toContain(
      '02.11.2026;2026-00042;1100;3400;forfait — 2026-00042;216.20;;;;;2026-00042;',
    );
  });
});
