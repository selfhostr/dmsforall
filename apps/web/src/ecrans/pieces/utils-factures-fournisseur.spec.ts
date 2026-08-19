import { describe, expect, it } from 'vitest';

import type { ReponseLigneFactureFournisseur } from '@dfa/shared';

import {
  calculerSyntheseEcarts,
  certitudeChampEnTete,
  certitudeChampLigne,
  deriverNatureEcart,
  formaterMontantEcart,
  formaterQuantiteEcart,
  origineVersCertitude,
} from './utils-factures-fournisseur';

function ligne(patch: Partial<ReponseLigneFactureFournisseur>): ReponseLigneFactureFournisseur {
  return {
    id: 'ligne-1',
    numeroOrdre: 1,
    referenceArticle: 'REF-1',
    designation: 'Plaquette de frein',
    quantiteMillieme: 2000,
    prixUnitaireCentimes: 5000,
    totalLigneCentimes: 10000,
    origine: 'texte_pdf',
    articleId: 'article-1',
    commandeFournisseurLigneId: 'cmd-ligne-1',
    ecart: { prixUnitaireCentimes: 0, quantiteMillieme: 0, totalCentimes: 0 },
    ...patch,
  };
}

describe('origineVersCertitude', () => {
  it('qr et texte_pdf sont certains, ocr ne l’est jamais', () => {
    expect(origineVersCertitude('qr')).toBe('certaine');
    expect(origineVersCertitude('texte_pdf')).toBe('certaine');
    expect(origineVersCertitude('ocr')).toBe('incertaine');
  });
});

describe('certitudeChampEnTete', () => {
  it('valeur null -> absente, quelle que soit la carte d’origine', () => {
    expect(certitudeChampEnTete(null, 'numeroFacture', { numeroFacture: 'qr' })).toBe('absente');
  });

  it('valeur présente, origine ocr -> incertaine', () => {
    expect(certitudeChampEnTete('F-2026-001', 'numeroFacture', { numeroFacture: 'ocr' })).toBe(
      'incertaine',
    );
  });

  it('valeur présente, origine qr -> certaine', () => {
    expect(certitudeChampEnTete('F-2026-001', 'numeroFacture', { numeroFacture: 'qr' })).toBe(
      'certaine',
    );
  });

  it('valeur présente sans entrée dans la carte (défensif) -> incertaine', () => {
    expect(certitudeChampEnTete('F-2026-001', 'numeroFacture', {})).toBe('incertaine');
  });
});

describe('certitudeChampLigne', () => {
  it('valeur null -> absente même sur une ligne lue avec certitude', () => {
    expect(certitudeChampLigne(null, 'qr')).toBe('absente');
  });

  it('reflète l’origine UNIQUE de la ligne', () => {
    expect(certitudeChampLigne('Plaquette', 'ocr')).toBe('incertaine');
    expect(certitudeChampLigne('Plaquette', 'qr')).toBe('certaine');
  });
});

describe('deriverNatureEcart', () => {
  it('aucune ligne de commande rapprochée -> non_rapprochee', () => {
    expect(deriverNatureEcart(ligne({ commandeFournisseurLigneId: null, ecart: null }))).toBe(
      'non_rapprochee',
    );
  });

  it('rapprochée, écart nul -> aucun', () => {
    expect(deriverNatureEcart(ligne({}))).toBe('aucun');
  });

  it('écart de quantité seul', () => {
    expect(
      deriverNatureEcart(
        ligne({ ecart: { prixUnitaireCentimes: 0, quantiteMillieme: 500, totalCentimes: 2500 } }),
      ),
    ).toBe('quantite');
  });

  it('écart de prix seul', () => {
    expect(
      deriverNatureEcart(
        ligne({ ecart: { prixUnitaireCentimes: 100, quantiteMillieme: 0, totalCentimes: 200 } }),
      ),
    ).toBe('prix_unitaire');
  });

  it('écart de quantité ET de prix', () => {
    expect(
      deriverNatureEcart(
        ligne({ ecart: { prixUnitaireCentimes: 100, quantiteMillieme: 500, totalCentimes: 2700 } }),
      ),
    ).toBe('quantite_et_prix');
  });
});

describe('calculerSyntheseEcarts', () => {
  it('aucune ligne en écart -> synthèse à zéro (arithmétique entière exacte)', () => {
    const synthese = calculerSyntheseEcarts([ligne({}), ligne({ id: 'ligne-2' })]);
    expect(synthese).toEqual({
      nombreLignesAvecEcart: 0,
      nombreLignesNonRapprochees: 0,
      ecartTotalCentimes: 0,
    });
  });

  it('somme les écarts CHIFFRABLES uniquement, jamais un arrondi flottant', () => {
    const synthese = calculerSyntheseEcarts([
      ligne({
        id: 'ligne-prix',
        ecart: { prixUnitaireCentimes: 250, quantiteMillieme: 0, totalCentimes: 1250 },
      }),
      ligne({
        id: 'ligne-quantite',
        ecart: { prixUnitaireCentimes: 0, quantiteMillieme: -500, totalCentimes: -375 },
      }),
      ligne({ id: 'ligne-conforme' }),
    ]);
    expect(synthese.nombreLignesAvecEcart).toBe(2);
    expect(synthese.nombreLignesNonRapprochees).toBe(0);
    // 1250 + (-375) = 875 centimes — entier exact, jamais `toBeCloseTo` (CONTRIBUTING.md).
    expect(synthese.ecartTotalCentimes).toBe(875);
  });

  it('une ligne non rapprochée compte dans les deux compteurs, sans écart chiffré', () => {
    const synthese = calculerSyntheseEcarts([
      ligne({ id: 'ligne-surprise', commandeFournisseurLigneId: null, ecart: null }),
    ]);
    expect(synthese).toEqual({
      nombreLignesAvecEcart: 1,
      nombreLignesNonRapprochees: 1,
      ecartTotalCentimes: 0,
    });
  });
});

describe('formaterMontantEcart', () => {
  it('préfixe un `+` explicite pour un écart positif', () => {
    expect(formaterMontantEcart(1250)).toBe('+12.50');
  });

  it('laisse le `-` natif pour un écart négatif', () => {
    expect(formaterMontantEcart(-1250)).toBe('-12.50');
  });

  it('un écart nul ne porte aucun signe', () => {
    expect(formaterMontantEcart(0)).toBe('0.00');
  });
});

describe('formaterQuantiteEcart', () => {
  it('préfixe un `+` explicite pour un écart positif', () => {
    expect(formaterQuantiteEcart(2500)).toBe('+2.5');
  });

  it('laisse le `-` natif pour un écart négatif', () => {
    expect(formaterQuantiteEcart(-1000)).toBe('-1');
  });
});
