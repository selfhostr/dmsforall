import { describe, expect, it } from 'vitest';

import {
  accumulerDocumentReconciliation,
  type MapReconciliationAnnee,
} from './reconciliation-annee-reprise';

describe('accumulerDocumentReconciliation — arithmétique EXACTE au centime, jamais un flottant', () => {
  it('un seul document -> total exact', () => {
    const carte = accumulerDocumentReconciliation(new Map(), 2023, 12_345);
    expect(carte.get(2023)).toEqual({ documents: 1, totalCentimes: 12_345 });
  });

  it('plusieurs documents la même année -> somme EXACTE (pas toBeCloseTo)', () => {
    let carte = accumulerDocumentReconciliation(new Map(), 2023, 10_050); // 100.50 CHF
    carte = accumulerDocumentReconciliation(carte, 2023, 333); // 3.33 CHF
    carte = accumulerDocumentReconciliation(carte, 2023, 1); // 0.01 CHF — le centime qui casse un flottant
    expect(carte.get(2023)).toEqual({ documents: 3, totalCentimes: 10_384 });
  });

  it('années distinctes -> compartiments indépendants', () => {
    let carte = accumulerDocumentReconciliation(new Map(), 2022, 5_000);
    carte = accumulerDocumentReconciliation(carte, 2023, 7_000);
    expect(carte.get(2022)).toEqual({ documents: 1, totalCentimes: 5_000 });
    expect(carte.get(2023)).toEqual({ documents: 1, totalCentimes: 7_000 });
  });

  it("n'affecte JAMAIS la carte reçue (immuable, sûr en cas de rejeu)", () => {
    const carteInitiale = new Map([[2023, { documents: 1, totalCentimes: 100 }]]);
    accumulerDocumentReconciliation(carteInitiale, 2023, 50);
    expect(carteInitiale.get(2023)).toEqual({ documents: 1, totalCentimes: 100 });
  });

  it('somme de 10 centimes répétés 3 fois == 30, jamais 29 ou 31 (piège classique du flottant)', () => {
    let carte: MapReconciliationAnnee = new Map();
    for (let i = 0; i < 3; i += 1) {
      carte = accumulerDocumentReconciliation(carte, 2024, 10);
    }
    expect(carte.get(2024)!.totalCentimes).toBe(30);
  });
});
