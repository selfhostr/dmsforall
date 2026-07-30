import { describe, expect, it } from 'vitest';

import {
  agregerTvaParTauxRegime,
  arrondiCommercial,
  calculerLigneDocument,
  calculerTotauxDocument,
  foisArrondiCommercial,
  resoudreRemiseGlobaleCentimes,
  ventilerRemiseGlobale,
} from './calcul-document';

describe('arrondiCommercial (MD-40)', () => {
  it('arrondit au plus proche entier', () => {
    expect(arrondiCommercial(10n, 3n)).toBe(3n); // 3.33 -> 3
    expect(arrondiCommercial(11n, 3n)).toBe(4n); // 3.67 -> 4
  });

  it("à égalité, s'éloigne de zéro — positif et négatif, symétrique (CF-02)", () => {
    expect(arrondiCommercial(5n, 2n)).toBe(3n); // 2.5 -> 3
    expect(arrondiCommercial(-5n, 2n)).toBe(-3n); // -2.5 -> -3 (PAS -2 : un avoir total doit solder au centime)
  });

  it('rejette un dénominateur non strictement positif', () => {
    expect(() => arrondiCommercial(10n, 0n)).toThrow();
    expect(() => arrondiCommercial(10n, -1n)).toThrow();
  });
});

describe('foisArrondiCommercial', () => {
  it('ne perd pas de précision sur un produit qui dépasserait un calcul flottant naïf', () => {
    // 999_999.99 CHF * 1000 millièmes, cas limite plausible d'une ligne extrême.
    expect(foisArrondiCommercial(99_999_999, 1000, 1000)).toBe(99_999_999);
  });
});

describe('calculerLigneDocument — pipeline TTC-ancré (migration 0010 §8, §0.2)', () => {
  it('forfait CHF 70.00 TTC à 8.1% — cas CF-13 du modèle documentaire, valeurs exactes', () => {
    // tva = arrondiCommercial(7'000 * 81, 1081) = 524.51... -> 525 ; ht = 7000 - 525 = 6475.
    const r = calculerLigneDocument({
      prixUnitaireTtcCentimes: 7000,
      quantiteMillieme: 1000,
      remisePourmille: null,
      remiseMontantCentimes: null,
      remiseGlobaleRepartieCentimes: 0,
      tauxTvaPourmille: 81,
    });
    expect(r.baseCentimes).toBe(7000);
    expect(r.ttcCentimes).toBe(7000);
    expect(r.tvaCentimes).toBe(525);
    expect(r.htCentimes).toBe(6475);
    expect(r.htCentimes + r.tvaCentimes).toBe(r.ttcCentimes); // invariant ligne_document_montant_coherent_chk
  });

  it('vente de véhicule CHF 24500.00 TTC à 8.1% — cas CF-07', () => {
    const r = calculerLigneDocument({
      prixUnitaireTtcCentimes: 24_500_00,
      quantiteMillieme: 1000,
      remisePourmille: null,
      remiseMontantCentimes: null,
      remiseGlobaleRepartieCentimes: 0,
      tauxTvaPourmille: 81,
    });
    expect(r.tvaCentimes).toBe(183_580);
    expect(r.htCentimes).toBe(2_266_420);
    expect(r.ttcCentimes).toBe(2_450_000);
  });

  it("ligne 'texte' sans prix rend tout à zéro", () => {
    const r = calculerLigneDocument({
      prixUnitaireTtcCentimes: null,
      quantiteMillieme: 1000,
      remisePourmille: null,
      remiseMontantCentimes: null,
      remiseGlobaleRepartieCentimes: 0,
      tauxTvaPourmille: 81,
    });
    expect(r).toEqual({ baseCentimes: 0, htCentimes: 0, tvaCentimes: 0, ttcCentimes: 0 });
  });

  it('remise en pour mille réduit le TTC avant TVA', () => {
    const r = calculerLigneDocument({
      prixUnitaireTtcCentimes: 10_000,
      quantiteMillieme: 1000,
      remisePourmille: 100, // 10%
      remiseMontantCentimes: null,
      remiseGlobaleRepartieCentimes: 0,
      tauxTvaPourmille: 81,
    });
    expect(r.baseCentimes).toBe(10_000);
    expect(r.ttcCentimes).toBe(9_000); // 10'000 - 1'000
    expect(r.htCentimes + r.tvaCentimes).toBe(r.ttcCentimes);
  });

  it('remise en montant et remise globale répartie se cumulent, jamais recalculées ensemble', () => {
    const r = calculerLigneDocument({
      prixUnitaireTtcCentimes: 10_000,
      quantiteMillieme: 1000,
      remisePourmille: null,
      remiseMontantCentimes: 500,
      remiseGlobaleRepartieCentimes: 300,
      tauxTvaPourmille: 81,
    });
    expect(r.ttcCentimes).toBe(9_200); // 10'000 - 500 - 300
  });

  it('ligne négative (avoir, répartition) reste cohérente en signe', () => {
    const r = calculerLigneDocument({
      prixUnitaireTtcCentimes: -7000,
      quantiteMillieme: 1000,
      remisePourmille: null,
      remiseMontantCentimes: null,
      remiseGlobaleRepartieCentimes: 0,
      tauxTvaPourmille: 81,
    });
    expect(r.ttcCentimes).toBe(-7000);
    expect(r.tvaCentimes).toBe(-525);
    expect(r.htCentimes).toBe(-6475);
    expect(r.htCentimes + r.tvaCentimes).toBe(r.ttcCentimes);
  });

  it.each([0, 26, 38, 81, 100, 770])('invariant ttc = ht + tva tient pour le taux %i ‰, tous montants', (taux) => {
    for (const prix of [1, 99, 100, 4_050, 7_000, 145_00, 999_999_99]) {
      const r = calculerLigneDocument({
        prixUnitaireTtcCentimes: prix,
        quantiteMillieme: 1000,
        remisePourmille: null,
        remiseMontantCentimes: null,
        remiseGlobaleRepartieCentimes: 0,
        tauxTvaPourmille: taux,
      });
      expect(r.htCentimes + r.tvaCentimes).toBe(r.ttcCentimes);
    }
  });
});

describe('resoudreRemiseGlobaleCentimes', () => {
  it('priorise le montant saisi sur le pour-mille', () => {
    expect(resoudreRemiseGlobaleCentimes(1000, null, 16_500)).toBe(1000);
  });

  it('dérive depuis le pour-mille si aucun montant saisi', () => {
    expect(resoudreRemiseGlobaleCentimes(null, 100, 10_000)).toBe(1000); // 10% de 10'000
  });

  it('rend 0 si aucun des deux champs', () => {
    expect(resoudreRemiseGlobaleCentimes(null, null, 10_000)).toBe(0);
  });
});

describe('ventilerRemiseGlobale (MD-59/MD-60) — CF-06 : trois lignes de base strictement égale', () => {
  it('répartit le résidu sur la ligne de plus petite numeroOrdre à égalité de base', () => {
    const lignes = [
      { id: 'L1', numeroOrdre: 1, baseCentimes: 5500 },
      { id: 'L2', numeroOrdre: 2, baseCentimes: 5500 },
      { id: 'L3', numeroOrdre: 3, baseCentimes: 5500 },
    ];
    const parts = ventilerRemiseGlobale(lignes, 1000);

    expect(parts.get('L1')).toBe(334);
    expect(parts.get('L2')).toBe(333);
    expect(parts.get('L3')).toBe(333);

    const somme = [...parts.values()].reduce((s, v) => s + v, 0);
    expect(somme).toBe(1000); // invariant MD-60 : Σ parts = remise globale saisie, au centime
  });

  it('répartit au prorata sur des bases distinctes, résidu à la plus grande base', () => {
    const lignes = [
      { id: 'A', numeroOrdre: 1, baseCentimes: 2000 },
      { id: 'B', numeroOrdre: 2, baseCentimes: 8000 },
    ];
    const parts = ventilerRemiseGlobale(lignes, 1000);
    const somme = [...parts.values()].reduce((s, v) => s + v, 0);
    expect(somme).toBe(1000);
    expect(parts.get('B')).toBeGreaterThan(parts.get('A')!);
  });

  it('rend 0 pour chaque ligne quand la remise globale est nulle', () => {
    const lignes = [{ id: 'A', numeroOrdre: 1, baseCentimes: 1000 }];
    const parts = ventilerRemiseGlobale(lignes, 0);
    expect(parts.get('A')).toBe(0);
  });

  it('liste vide : ne lève pas, rend une map vide', () => {
    expect(ventilerRemiseGlobale([], 1000).size).toBe(0);
  });
});

describe('agregerTvaParTauxRegime (MD-44)', () => {
  it('agrège par couple (régime, taux), jamais recalculé sur une base agrégée', () => {
    const lignes = [
      { regimeTva: 'normal', tauxTvaPourmille: 81, htCentimes: 1000, tvaCentimes: 81 },
      { regimeTva: 'normal', tauxTvaPourmille: 81, htCentimes: 2000, tvaCentimes: 162 },
      { regimeTva: 'reduit', tauxTvaPourmille: 26, htCentimes: 500, tvaCentimes: 13 },
    ];
    const ventilation = agregerTvaParTauxRegime(lignes);
    expect(ventilation).toHaveLength(2);
    const normal = ventilation.find((v) => v.regimeTva === 'normal');
    expect(normal).toEqual({ regimeTva: 'normal', tauxTvaPourmille: 81, baseCentimes: 3000, tvaCentimes: 243 });
    const reduit = ventilation.find((v) => v.regimeTva === 'reduit');
    expect(reduit).toEqual({ regimeTva: 'reduit', tauxTvaPourmille: 26, baseCentimes: 500, tvaCentimes: 13 });
  });
});

describe('calculerTotauxDocument', () => {
  it('Σ ht + Σ tva = Σ ttc, sur des lignes réelles', () => {
    const lignes = [
      calculerLigneDocument({
        prixUnitaireTtcCentimes: 7000,
        quantiteMillieme: 1000,
        remisePourmille: null,
        remiseMontantCentimes: null,
        remiseGlobaleRepartieCentimes: 0,
        tauxTvaPourmille: 81,
      }),
      calculerLigneDocument({
        prixUnitaireTtcCentimes: 24_500_00,
        quantiteMillieme: 1000,
        remisePourmille: null,
        remiseMontantCentimes: null,
        remiseGlobaleRepartieCentimes: 0,
        tauxTvaPourmille: 81,
      }),
    ];
    const totaux = calculerTotauxDocument(lignes);
    expect(totaux.totalHtCentimes + totaux.totalTvaCentimes).toBe(totaux.totalTtcCentimes);
    expect(totaux.totalTtcCentimes).toBe(7000 + 2_450_000);
  });
});
