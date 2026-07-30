import { describe, expect, it } from 'vitest';

import type { LigneDocumentVente, LigneDocumentVenteTva, LigneLigneDocument } from '../../../db/schema';
import { ComptesResolusADate, indexerCodesTva, indexerComptes } from './comptes-resolus';
import { construireEcritureDocument } from './construction-ecriture';

/**
 * Cas de test chiffrés (montants exacts, jamais `toBeCloseTo`) pour `construireEcritureDocument`
 * — la fonction la plus sensible de ce lot : une erreur de signe ou de regroupement produit une
 * écriture qui SEMBLE équilibrée (le CHECK `bigint` interne le vérifie) mais impute le mauvais
 * compte, ce qui ne se découvre qu'au bouclement fiduciaire (MD-92/93).
 */

function document(champs: Partial<LigneDocumentVente>): LigneDocumentVente {
  return {
    id: 'doc-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    statut: 'emis',
    statutReglement: 'non_regle',
    numeroSequence: 318,
    numero: '2026-00318',
    numeroOrigine: null,
    exercice: 2026,
    dateDocument: '2026-07-30',
    datePrestationDebut: null,
    datePrestationFin: null,
    dateEcheance: null,
    emisLe: new Date('2026-07-30T10:00:00Z'),
    clientId: 'client-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    clientDesignationFigee: 'Garage Client SA',
    clientIdeFige: null,
    langueFigee: 'fr',
    adresseFacturationFigee: {},
    conditionsPaiementFigees: {},
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    porteeAvoir: null,
    motifAvoir: null,
    motifAvoirLibre: null,
    tvaNonVentilee: false,
    tauxTvaPourmille: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 0n,
    totalTvaCentimes: 0n,
    ecartRepriseCentimes: 0n,
    totalTtcCentimes: 0n,
    remiseGlobalePourmille: null,
    remiseGlobaleSaisieCentimes: null,
    montantRegleCentimes: 0n,
    soldeCentimes: 0n,
    devise: 'CHF',
    qrIban: null,
    creancierNom: null,
    creancierRue: null,
    creancierNumero: null,
    creancierNpa: null,
    creancierLocalite: null,
    creancierPays: null,
    typeReferenceQr: null,
    qrReference: null,
    qrMontantCentimes: null,
    qrDevise: null,
    qrLangue: null,
    qrDebiteurPresent: false,
    qrPayload: null,
    qrPayloadSha256: null,
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    relanceNiveau: 0,
    relanceLe: null,
    contentieux: false,
    creeLe: new Date('2026-07-30T09:00:00Z'),
    modifieLe: new Date('2026-07-30T10:00:00Z'),
    ...champs,
  };
}

function ligne(champs: Partial<LigneLigneDocument>): LigneLigneDocument {
  return {
    id: 'ligne-1',
    tenantId: 'tenant-1',
    documentId: 'doc-1',
    numeroOrdre: 1,
    typeLigne: 'piece',
    designation: 'Ligne',
    referenceTexte: null,
    ligneOrId: null,
    documentAcompteId: null,
    categorieComptable: null,
    modeCalculTva: 'ttc',
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    datePrestation: '2026-07-30',
    quantiteMillieme: 1000,
    prixUnitaireCentimes: 0,
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    baseCentimes: 0,
    htCentimes: 0,
    tvaCentimes: 0,
    ttcCentimes: 0,
    montantValoriseCentimes: null,
    creeLe: new Date('2026-07-30T09:00:00Z'),
    modifieLe: new Date('2026-07-30T09:00:00Z'),
    ...champs,
  };
}

function ventilation(champs: Partial<LigneDocumentVenteTva>): LigneDocumentVenteTva {
  return {
    id: 'tva-1',
    tenantId: 'tenant-1',
    documentId: 'doc-1',
    regimeTva: 'normal',
    tauxTvaPourmille: 81,
    baseCentimes: 0,
    tvaCentimes: 0,
    creeLe: new Date('2026-07-30T10:00:00Z'),
    ...champs,
  };
}

/** Plan comptable minimal du tenant de test — un compte par usage/catégorie utilisé ci-dessous. */
function comptesDeTest(): ComptesResolusADate {
  const comptes = indexerComptes([
    { usage: 'creances_clients', categorie: 'defaut', compte: '1100' },
    { usage: 'produit', categorie: 'main_oeuvre_bareme', compte: '3400' },
    { usage: 'produit', categorie: 'piece', compte: '3200' },
    { usage: 'tva_due', categorie: '81', compte: '2200' },
    { usage: 'acomptes_recus', categorie: 'defaut', compte: '2030' },
    { usage: 'ecart_reprise', categorie: 'defaut', compte: '1090' },
  ]);
  const codesTva = indexerCodesTva([{ regimeTva: 'normal', tauxPourmille: 81, codeExterne: 'TVA81' }]);
  return new ComptesResolusADate(comptes, codesTva);
}

describe('construireEcritureDocument', () => {
  it('facture ordinaire, deux catégories de produit, un taux : débit créances = crédit (produits + TVA)', () => {
    const doc = document({ totalHtCentimes: 15000n, totalTvaCentimes: 1215n, totalTtcCentimes: 16215n });
    const lignes = [
      ligne({ id: 'l1', typeLigne: 'main_oeuvre_bareme', htCentimes: 10000, tvaCentimes: 810, ttcCentimes: 10810 }),
      ligne({ id: 'l2', numeroOrdre: 2, typeLigne: 'piece', htCentimes: 5000, tvaCentimes: 405, ttcCentimes: 5405 }),
    ];
    const tva = [ventilation({ baseCentimes: 15000, tvaCentimes: 1215 })];

    const resultat = construireEcritureDocument(doc, lignes, tva, comptesDeTest(), null);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(16215n);
    expect(resultat.totalCreditCentimes).toBe(16215n);
    expect(resultat.ecriture.reference).toBe('2026-00318');
    expect(resultat.ecriture.lignes).toEqual([
      { compte: '1100', sens: 'debit', montantCentimes: 16215, codeTva: null, tauxPourmille: null, baseTvaCentimes: null, libelle: 'Créances — Garage Client SA' },
      { compte: '3400', sens: 'credit', montantCentimes: 10000, codeTva: null, tauxPourmille: null, baseTvaCentimes: null, libelle: 'main_oeuvre_bareme — 2026-00318' },
      { compte: '3200', sens: 'credit', montantCentimes: 5000, codeTva: null, tauxPourmille: null, baseTvaCentimes: null, libelle: 'piece — 2026-00318' },
      { compte: '2200', sens: 'credit', montantCentimes: 1215, codeTva: 'TVA81', tauxPourmille: 81, baseTvaCentimes: 15000, libelle: 'TVA due 8.1% — 2026-00318' },
    ]);
  });

  it('avoir (MD-46, montants négatifs) : la polarité bascule automatiquement, sans branche sur typeDocument', () => {
    const doc = document({
      id: 'doc-2',
      typeDocument: 'avoir',
      numero: '2026-A-004',
      numeroSequence: 4,
      totalHtCentimes: -15000n,
      totalTvaCentimes: -1215n,
      totalTtcCentimes: -16215n,
      factureAnnuleeId: 'doc-1',
    });
    const lignes = [
      ligne({ id: 'l1', documentId: 'doc-2', typeLigne: 'main_oeuvre_bareme', htCentimes: -10000, tvaCentimes: -810, ttcCentimes: -10810 }),
      ligne({ id: 'l2', documentId: 'doc-2', numeroOrdre: 2, typeLigne: 'piece', htCentimes: -5000, tvaCentimes: -405, ttcCentimes: -5405 }),
    ];
    const tva = [ventilation({ documentId: 'doc-2', baseCentimes: -15000, tvaCentimes: -1215 })];

    const resultat = construireEcritureDocument(doc, lignes, tva, comptesDeTest(), null);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(16215n);
    expect(resultat.totalCreditCentimes).toBe(16215n);
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('1100')).toMatchObject({ sens: 'credit', montantCentimes: 16215 });
    expect(parCompte.get('3400')).toMatchObject({ sens: 'debit', montantCentimes: 10000 });
    expect(parCompte.get('3200')).toMatchObject({ sens: 'debit', montantCentimes: 5000 });
    expect(parCompte.get('2200')).toMatchObject({ sens: 'debit', montantCentimes: 1215 });
  });

  it("facture finale avec acompte (MD-55) : la ligne acompte_deduit bascule seule au débit (acomptes reçus), sans code dédié", () => {
    const doc = document({ totalHtCentimes: 15000n, totalTvaCentimes: 1215n, totalTtcCentimes: 16215n });
    const lignes = [
      ligne({ id: 'l1', typeLigne: 'main_oeuvre_bareme', htCentimes: 20000, tvaCentimes: 1620, ttcCentimes: 21620 }),
      ligne({
        id: 'l2',
        numeroOrdre: 2,
        typeLigne: 'acompte_deduit',
        documentAcompteId: 'doc-acompte',
        htCentimes: -5000,
        tvaCentimes: -405,
        ttcCentimes: -5405,
      }),
    ];
    const tva = [ventilation({ baseCentimes: 15000, tvaCentimes: 1215 })];

    const resultat = construireEcritureDocument(doc, lignes, tva, comptesDeTest(), null);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    // Créances (solde) 16215 + Acomptes reçus 5000 = 21215, au débit.
    expect(resultat.totalDebitCentimes).toBe(21215n);
    // Produits 20000 + TVA due 1215 = 21215, au crédit.
    expect(resultat.totalCreditCentimes).toBe(21215n);
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('2030')).toMatchObject({ sens: 'debit', montantCentimes: 5000 });
    expect(parCompte.get('3400')).toMatchObject({ sens: 'credit', montantCentimes: 20000 });
  });

  it('un regroupement dont la somme nette est nulle ne produit aucune ligne et ne réclame aucun compte', () => {
    const doc = document({ totalHtCentimes: 0n, totalTvaCentimes: 0n, totalTtcCentimes: 0n });
    const lignes = [
      ligne({ id: 'l1', typeLigne: 'piece', htCentimes: 1000, tvaCentimes: 0, ttcCentimes: 1000, tauxTvaPourmille: 0, regimeTva: 'exonere' }),
      ligne({ id: 'l2', numeroOrdre: 2, typeLigne: 'piece', htCentimes: -1000, tvaCentimes: 0, ttcCentimes: -1000, tauxTvaPourmille: 0, regimeTva: 'exonere' }),
    ];
    const comptesSansPiece = new ComptesResolusADate(indexerComptes([{ usage: 'creances_clients', categorie: 'defaut', compte: '1100' }]), indexerCodesTva([]));

    const resultat = construireEcritureDocument(doc, lignes, [], comptesSansPiece, null);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.ecriture.lignes).toHaveLength(0);
    expect(resultat.totalDebitCentimes).toBe(0n);
    expect(resultat.totalCreditCentimes).toBe(0n);
  });

  it('mapping_compte manquant : refuse et nomme précisément ce qui manque (RF-112), ne construit rien', () => {
    const doc = document({ totalHtCentimes: 5000n, totalTvaCentimes: 405n, totalTtcCentimes: 5405n });
    const lignes = [ligne({ id: 'l1', typeLigne: 'piece', htCentimes: 5000, tvaCentimes: 405, ttcCentimes: 5405 })];
    const tva = [ventilation({ baseCentimes: 5000, tvaCentimes: 405 })];
    const comptesIncomplets = new ComptesResolusADate(
      indexerComptes([{ usage: 'creances_clients', categorie: 'defaut', compte: '1100' }]),
      indexerCodesTva([]),
    );

    const resultat = construireEcritureDocument(doc, lignes, tva, comptesIncomplets, null);

    expect(resultat.succes).toBe(false);
    if (resultat.succes) return;
    expect(resultat.manquants).toEqual(
      expect.arrayContaining([
        { type: 'compte', usage: 'produit', categorie: 'piece', documentNumero: '2026-00318' },
        { type: 'compte', usage: 'tva_due', categorie: '81', documentNumero: '2026-00318' },
        { type: 'code_tva', regimeTva: 'normal', tauxPourmille: 81, documentNumero: '2026-00318' },
      ]),
    );
  });

  it('categorieComptable (AC-09) prime sur typeLigne pour résoudre le compte produit', () => {
    const doc = document({ totalHtCentimes: 5000n, totalTvaCentimes: 405n, totalTtcCentimes: 5405n });
    const lignes = [ligne({ id: 'l1', typeLigne: 'piece', categorieComptable: 'recyclage', htCentimes: 5000, tvaCentimes: 405, ttcCentimes: 5405 })];
    const tva = [ventilation({ baseCentimes: 5000, tvaCentimes: 405 })];
    const comptes = new ComptesResolusADate(
      indexerComptes([
        { usage: 'creances_clients', categorie: 'defaut', compte: '1100' },
        { usage: 'produit', categorie: 'recyclage', compte: '3600' },
        { usage: 'tva_due', categorie: '81', compte: '2200' },
      ]),
      indexerCodesTva([{ regimeTva: 'normal', tauxPourmille: 81, codeExterne: 'TVA81' }]),
    );

    const resultat = construireEcritureDocument(doc, lignes, tva, comptes, null);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.has('3600')).toBe(true);
  });
});
