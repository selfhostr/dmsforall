import { describe, expect, it } from 'vitest';

import { ComptesResolusADate, indexerCodesTva, indexerComptes } from './comptes-resolus';
import {
  construireEcriturePaiement,
  type DocumentPourEcriturePaiement,
  type ImputationPourEcriturePaiement,
  type PaiementPourEcriture,
} from './construction-ecriture-paiement';

/**
 * Cas de test chiffrés (montants exacts, jamais `toBeCloseTo`) pour `construireEcriturePaiement` —
 * chaque cas reprend, au centime, un `CF-xx` du modèle documentaire (`docs/modele-documentaire-
 * facturation.md` §9) ou l'exemple `MD-57` du remboursement. `CF-08` (le paiement RÉEL du seed,
 * virement 150.00 CHF sur la facture Master `2026-00001`) est prouvé séparément en base — voir le
 * rapport de livraison.
 *
 * `financierNouveauCetExport` (dernier paramètre) — migration 0019 (MD-91) : le suivi d'export a la
 * granularité de l'IMPUTATION (`imputation_paiement.exporteLe`), pas du paiement — un paiement peut
 * recevoir de nouvelles imputations APRÈS avoir déjà été exporté une première fois. `true` dans tous
 * les cas ci-dessus qui représentent un PREMIER export de ce paiement (le cash n'a encore jamais été
 * transmis) ; les cas `financierNouveauCetExport: false`, à la fin, prouvent la ligne financière
 * ABSENTE et l'avance déjà tenue DÉBITÉE plutôt qu'un nouvel encaissement compté deux fois.
 */

function paiement(champs: Partial<PaiementPourEcriture>): PaiementPourEcriture {
  return {
    id: 'paiement-1',
    dateValeur: '2026-07-12',
    moyen: 'virement',
    montantCentimes: 0n,
    payeurLibelle: 'Transports Rhône Sàrl',
    ...champs,
  };
}

function imputation(champs: Partial<ImputationPourEcriturePaiement>): ImputationPourEcriturePaiement {
  return {
    documentId: 'doc-1',
    montantCentimes: 0n,
    nature: 'reglement',
    ...champs,
  };
}

/** Plan comptable minimal du tenant de test — un compte par usage/catégorie utilisé ci-dessous. */
function comptesDeTest(): ComptesResolusADate {
  const comptes = indexerComptes([
    { usage: 'financier', categorie: 'virement', compte: '1020' },
    { usage: 'financier', categorie: 'especes', compte: '1000' },
    { usage: 'creances_clients', categorie: 'defaut', compte: '1100' },
    { usage: 'acomptes_recus', categorie: 'defaut', compte: '2030' },
    { usage: 'arrondi', categorie: 'defaut', compte: '3900' },
    { usage: 'escompte', categorie: 'defaut', compte: '3800' },
    { usage: 'perte', categorie: 'defaut', compte: '3805' },
    { usage: 'tva_due', categorie: '81', compte: '2200' },
  ]);
  const codesTva = indexerCodesTva([{ regimeTva: 'normal', tauxPourmille: 81, codeExterne: 'TVA81' }]);
  return new ComptesResolusADate(comptes, codesTva);
}

function documentsDeTest(entrees: Record<string, DocumentPourEcriturePaiement>): ReadonlyMap<string, DocumentPourEcriturePaiement> {
  return new Map(Object.entries(entrees));
}

describe('construireEcriturePaiement', () => {
  it('CF-08 (seed réel) : règlement simple, un document, virement — D Banque / C Créances', () => {
    // Facture Master 2026-00001, 240.00 CHF TTC, virement de 150.00 CHF imputé en reglement.
    const p = paiement({ id: 'paiement-master', montantCentimes: 15_000n });
    const imps = [imputation({ documentId: 'doc-master', montantCentimes: 15_000n, nature: 'reglement' })];
    const docs = documentsDeTest({ 'doc-master': { numero: '2026-00001', ventilationTva: [] } });

    const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, true);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(15_000n);
    expect(resultat.totalCreditCentimes).toBe(15_000n);
    expect(resultat.ecriture.reference).toBe('paiement-master');
    // `documentId` reste TOUJOURS `null` sur une écriture de paiement, même sur un règlement
    // portant sur un seul document — piège vérifié en exécution : le document 2026-00001 ET ce
    // paiement sont candidats dans le MÊME lot, et `winbiz-serialiseur.ts::verifierAucunDoublon`
    // refuse un `documentId` présent plus d'une fois dans un lot (garde MD-92 contre le double
    // export). Voir l'en-tête de `construireEcriturePaiement`.
    expect(resultat.ecriture.documentId).toBeNull();
    expect(resultat.ecriture.lignes).toEqual([
      { compte: '1020', sens: 'debit', montantCentimes: 15_000, codeTva: null, tauxPourmille: null, baseTvaCentimes: null, libelle: 'Encaissement (virement) — Transports Rhône Sàrl' },
      { compte: '1100', sens: 'credit', montantCentimes: 15_000, codeTva: null, tauxPourmille: null, baseTvaCentimes: null, libelle: 'Encaissement — 2026-00001' },
    ]);
  });

  it('CF-11 : trop-perçu — la part non imputée crédite les acomptes reçus, aucune TVA', () => {
    const p = paiement({ id: 'paiement-cf11', montantCentimes: 58_560n });
    const imps = [imputation({ documentId: 'doc-cf01', montantCentimes: 56_660n, nature: 'reglement' })];
    const docs = documentsDeTest({ 'doc-cf01': { numero: '2026-00318', ventilationTva: [] } });

    const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, true);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(58_560n);
    expect(resultat.totalCreditCentimes).toBe(58_560n);
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('1020')).toMatchObject({ sens: 'debit', montantCentimes: 58_560 });
    expect(parCompte.get('1100')).toMatchObject({ sens: 'credit', montantCentimes: 56_660 });
    expect(parCompte.get('2030')).toMatchObject({ sens: 'credit', montantCentimes: 1_900 });
    expect(resultat.ecriture.lignes).toHaveLength(3);
  });

  it("CF-05 (ligne 1) : arrondi espèces +0.01 — la caisse encaisse MOINS que la facture, débit du compte d'arrondi", () => {
    // Facture 204.31, espèces encaissées 204.30 : reglement 204.30 + arrondi +0.01.
    const p = paiement({ id: 'paiement-cf05a', montantCentimes: 20_430n, moyen: 'especes' });
    const imps = [
      imputation({ documentId: 'doc-cf05', montantCentimes: 20_430n, nature: 'reglement' }),
      imputation({ documentId: 'doc-cf05', montantCentimes: 1n, nature: 'arrondi' }),
    ];
    const docs = documentsDeTest({ 'doc-cf05': { numero: '2026-00099', ventilationTva: [] } });

    const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, true);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(20_431n);
    expect(resultat.totalCreditCentimes).toBe(20_431n);
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('1000')).toMatchObject({ sens: 'debit', montantCentimes: 20_430 }); // Caisse
    expect(parCompte.get('3900')).toMatchObject({ sens: 'debit', montantCentimes: 1 }); // Arrondi
    expect(parCompte.get('1100')).toMatchObject({ sens: 'credit', montantCentimes: 20_431 }); // Créances
  });

  it("CF-05 (ligne 2) : arrondi espèces -0.02 — la caisse encaisse PLUS que la facture, crédit du compte d'arrondi", () => {
    // Facture 204.33, espèces encaissées 204.35 : reglement 204.35 + arrondi -0.02.
    const p = paiement({ id: 'paiement-cf05b', montantCentimes: 20_435n, moyen: 'especes' });
    const imps = [
      imputation({ documentId: 'doc-cf05b', montantCentimes: 20_435n, nature: 'reglement' }),
      imputation({ documentId: 'doc-cf05b', montantCentimes: -2n, nature: 'arrondi' }),
    ];
    const docs = documentsDeTest({ 'doc-cf05b': { numero: '2026-00100', ventilationTva: [] } });

    const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, true);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(20_435n);
    expect(resultat.totalCreditCentimes).toBe(20_435n);
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('1000')).toMatchObject({ sens: 'debit', montantCentimes: 20_435 }); // Caisse
    expect(parCompte.get('1100')).toMatchObject({ sens: 'credit', montantCentimes: 20_433 }); // Créances
    expect(parCompte.get('3900')).toMatchObject({ sens: 'credit', montantCentimes: 2 }); // Arrondi (gain)
  });

  it('CF-14 : escompte 2 % avec correction proportionnelle de TVA — le calcul tombe juste au centime', () => {
    // Facture 3459.20 TTC (81 ‰), escompte 69.18 (dont TVA 5.18, HT 64.00), client verse 3390.02.
    const p = paiement({ id: 'paiement-cf14', montantCentimes: 339_002n });
    const imps = [
      imputation({ documentId: 'doc-cf14', montantCentimes: 339_002n, nature: 'reglement' }),
      imputation({ documentId: 'doc-cf14', montantCentimes: 6_918n, nature: 'escompte' }),
    ];
    const docs = documentsDeTest({
      'doc-cf14': { numero: '2026-00500', ventilationTva: [{ regimeTva: 'normal', tauxTvaPourmille: 81 }] },
    });

    const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, true);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(345_920n);
    expect(resultat.totalCreditCentimes).toBe(345_920n);
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('1020')).toMatchObject({ sens: 'debit', montantCentimes: 339_002 });
    expect(parCompte.get('3800')).toMatchObject({ sens: 'debit', montantCentimes: 6_400 }); // Escompte HT
    expect(parCompte.get('2200')).toMatchObject({ sens: 'debit', montantCentimes: 518, codeTva: 'TVA81', tauxPourmille: 81 }); // TVA corrigée
    expect(parCompte.get('1100')).toMatchObject({ sens: 'credit', montantCentimes: 345_920 });
  });

  it("MD-57 : remboursement d'une avance non imputée — paiement négatif, aucune imputation, aucune TVA", () => {
    const p = paiement({ id: 'paiement-remboursement', montantCentimes: -1_900n });
    const resultat = construireEcriturePaiement(p, [], documentsDeTest({}), comptesDeTest(), null, true);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(1_900n);
    expect(resultat.totalCreditCentimes).toBe(1_900n);
    expect(resultat.ecriture.documentId).toBeNull();
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('2030')).toMatchObject({ sens: 'debit', montantCentimes: 1_900 }); // Avance reprise
    expect(parCompte.get('1020')).toMatchObject({ sens: 'credit', montantCentimes: 1_900 }); // Banque (sortie)
    expect(resultat.ecriture.lignes).toHaveLength(2);
  });

  it("nature 'compensation' : reportée en limite, aucune écriture inventée (MD-84 §6.2 ne la documente pas)", () => {
    const p = paiement({ id: 'paiement-compensation', montantCentimes: 1_900n });
    const imps = [imputation({ documentId: 'doc-regularisation', montantCentimes: 1_900n, nature: 'compensation' })];

    const resultat = construireEcriturePaiement(p, imps, documentsDeTest({}), comptesDeTest(), null, true);

    expect(resultat.succes).toBe(false);
    if (resultat.succes) return;
    expect(resultat.limites).toEqual([{ type: 'compensation_non_supportee', paiementId: 'paiement-compensation', documentId: 'doc-regularisation' }]);
    expect(resultat.manquants).toEqual([]);
  });

  it('escompte sur un document à plusieurs taux de TVA : reportée en limite, pas de répartition devinée', () => {
    const p = paiement({ id: 'paiement-multitaux', montantCentimes: 1_000n });
    const imps = [imputation({ documentId: 'doc-multitaux', montantCentimes: 1_000n, nature: 'escompte' })];
    const docs = documentsDeTest({
      'doc-multitaux': {
        numero: '2026-00600',
        ventilationTva: [
          { regimeTva: 'normal', tauxTvaPourmille: 81 },
          { regimeTva: 'reduit', tauxTvaPourmille: 26 },
        ],
      },
    });

    const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, true);

    expect(resultat.succes).toBe(false);
    if (resultat.succes) return;
    expect(resultat.limites).toEqual([{ type: 'taux_multiples_non_supporte', paiementId: 'paiement-multitaux', documentId: 'doc-multitaux', nature: 'escompte' }]);
  });

  it('MD-57 issue 2 / migration 0019 : avance reçue sans imputation — premier export, tout part en acomptes reçus', () => {
    // Étape 1 d'un scénario en deux temps (voir le test suivant) : le client verse 50.00 CHF sans
    // qu'aucune facture n'existe encore — un paiement créé SANS imputation (RF-65).
    const p = paiement({ id: 'paiement-avance', montantCentimes: 5_000n });
    const resultat = construireEcriturePaiement(p, [], documentsDeTest({}), comptesDeTest(), null, true);

    expect(resultat.succes).toBe(true);
    if (!resultat.succes) return;
    expect(resultat.totalDebitCentimes).toBe(5_000n);
    expect(resultat.totalCreditCentimes).toBe(5_000n);
    const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
    expect(parCompte.get('1020')).toMatchObject({ sens: 'debit', montantCentimes: 5_000 });
    expect(parCompte.get('2030')).toMatchObject({ sens: 'credit', montantCentimes: 5_000 });
    expect(resultat.ecriture.lignes).toHaveLength(2);
  });

  it(
    "MD-57 issue 2 / migration 0019 : la même avance imputée PLUS TARD sur une nouvelle facture — " +
      "export ultérieur, AUCUNE ligne financière (le cash a déjà été transmis), l'avance déjà tenue est débitée",
    () => {
      // Étape 2 : trois semaines plus tard, une facture 30.00 CHF existe enfin — le comptable impute
      // 30.00 CHF de l'avance dessus (`POST /paiements/{id}/imputations`). C'est EXACTEMENT le trou
      // que la migration 0019 corrige : sans elle, `paiement.exporte_le` (déjà non nul depuis le
      // test précédent) aurait empêché cette imputation de jamais partir à l'export.
      const p = paiement({ id: 'paiement-avance', montantCentimes: 5_000n, dateValeur: '2026-08-02' });
      const imps = [imputation({ documentId: 'doc-tardif', montantCentimes: 3_000n, nature: 'reglement' })];
      const docs = documentsDeTest({ 'doc-tardif': { numero: '2026-00777', ventilationTva: [] } });

      const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, false);

      expect(resultat.succes).toBe(true);
      if (!resultat.succes) return;
      // Équilibre au centime — 30.00 CHF, PAS 80.00 (50.00 déjà transmises + 30.00) : la preuve
      // arithmétique que le cash n'est pas compté deux fois.
      expect(resultat.totalDebitCentimes).toBe(3_000n);
      expect(resultat.totalCreditCentimes).toBe(3_000n);
      const parCompte = new Map(resultat.ecriture.lignes.map((l) => [l.compte, l]));
      expect(parCompte.has('1020')).toBe(false); // AUCUNE ligne financière — voir l'assertion ci-dessus.
      expect(parCompte.get('2030')).toMatchObject({ sens: 'debit', montantCentimes: 3_000 }); // avance reprise
      expect(parCompte.get('1100')).toMatchObject({ sens: 'credit', montantCentimes: 3_000, libelle: 'Affectation — 2026-00777' });
      expect(resultat.ecriture.lignes).toHaveLength(2);
      // Même piège que la collision `documentId` déjà trouvée et corrigée (voir CF-08 ci-dessus) :
      // cette écriture PEUT légitimement partir dans un lot qui contient AUSSI une écriture de
      // document pour `doc-tardif` — `documentId: null` la protège identiquement ici.
      expect(resultat.ecriture.documentId).toBeNull();
    },
  );

  it('mapping_compte manquant (moyen de paiement non paramétré) : refuse et nomme précisément ce qui manque', () => {
    const p = paiement({ id: 'paiement-twint', montantCentimes: 5_000n, moyen: 'twint' });
    const imps = [imputation({ documentId: 'doc-twint', montantCentimes: 5_000n, nature: 'reglement' })];
    const docs = documentsDeTest({ 'doc-twint': { numero: '2026-00700', ventilationTva: [] } });

    const resultat = construireEcriturePaiement(p, imps, docs, comptesDeTest(), null, true);

    expect(resultat.succes).toBe(false);
    if (resultat.succes) return;
    expect(resultat.manquants).toEqual(
      expect.arrayContaining([{ type: 'compte', usage: 'financier', categorie: 'twint', documentNumero: 'paiement-twint' }]),
    );
  });
});
