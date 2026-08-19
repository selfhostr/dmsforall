import { describe, expect, it } from 'vitest';

import {
  centimesDepuisTexteLibre,
  extraireLigneDepuisTexte,
  extraireLignesFacture,
  milliemeDepuisTexteLibre,
} from './extraction-lignes-facture';

describe('centimesDepuisTexteLibre', () => {
  it('montant simple', () => {
    expect(centimesDepuisTexteLibre('50.00')).toBe(5000);
  });

  it('séparateur de milliers apostrophe (format suisse, CONTRIBUTING.md)', () => {
    expect(centimesDepuisTexteLibre("1'234.50")).toBe(123450);
  });

  it('virgule comme séparateur décimal', () => {
    expect(centimesDepuisTexteLibre('12,50')).toBe(1250);
  });

  it('entier sans décimales', () => {
    expect(centimesDepuisTexteLibre('50')).toBe(5000);
  });

  it('jeton non numérique -> null', () => {
    expect(centimesDepuisTexteLibre('ABC-123')).toBeNull();
  });
});

describe('milliemeDepuisTexteLibre', () => {
  it('entier -> millièmes', () => {
    expect(milliemeDepuisTexteLibre('4')).toBe(4000);
  });

  it('décimal -> millièmes', () => {
    expect(milliemeDepuisTexteLibre('1.5')).toBe(1500);
  });

  it('jeton non numérique -> null', () => {
    expect(milliemeDepuisTexteLibre('quatre')).toBeNull();
  });
});

describe('extraireLigneDepuisTexte', () => {
  it('motif complet : référence, désignation, quantité, prix, total', () => {
    const resultat = extraireLigneDepuisTexte('ABC-123 Filtre à huile 4 12.50 50.00', 'texte_pdf');
    expect(resultat).toEqual({
      referenceArticle: 'ABC-123',
      designation: 'Filtre à huile',
      quantiteMillieme: 4000,
      prixUnitaireCentimes: 1250,
      totalLigneCentimes: 5000,
      origine: 'texte_pdf',
    });
  });

  it('sans référence reconnaissable en tête : tout devient désignation', () => {
    const resultat = extraireLigneDepuisTexte('Frais de port 1 15.00 15.00', 'texte_pdf');
    expect(resultat?.referenceArticle).toBeNull();
    expect(resultat?.designation).toBe('Frais de port');
  });

  it('un nombre DANS la désignation (ex. filetage M18x1.5) n’est pas confondu avec les 3 finaux', () => {
    const resultat = extraireLigneDepuisTexte(
      'BOUGIE-M18X1.5 Bougie allumage M18x1.5 2 8.00 16.00',
      'texte_pdf',
    );
    expect(resultat?.quantiteMillieme).toBe(2000);
    expect(resultat?.prixUnitaireCentimes).toBe(800);
    expect(resultat?.totalLigneCentimes).toBe(1600);
  });

  it('ligne d’en-tête de tableau — pas assez de structure -> ignorée', () => {
    expect(
      extraireLigneDepuisTexte('Référence Désignation Qté Prix Total', 'texte_pdf'),
    ).toBeNull();
  });

  it('ligne de total général (un seul nombre) -> ignorée', () => {
    expect(extraireLigneDepuisTexte('Total à payer 1234.50', 'texte_pdf')).toBeNull();
  });

  it('ligne vide -> ignorée', () => {
    expect(extraireLigneDepuisTexte('', 'texte_pdf')).toBeNull();
  });

  it('quantité nulle -> refusée (schemaQuantiteMillieme exige > 0)', () => {
    expect(extraireLigneDepuisTexte('ABC-1 Pièce 0 10.00 0.00', 'texte_pdf')).toBeNull();
  });

  it('porte l’origine transmise (texte_pdf vs ocr)', () => {
    expect(extraireLigneDepuisTexte('ABC-1 Pièce 1 10.00 10.00', 'ocr')?.origine).toBe('ocr');
  });
});

describe('extraireLignesFacture', () => {
  it('extrait uniquement les lignes reconnues, dans l’ordre, en ignorant le reste', () => {
    const texte = [
      'Facture fournisseur N° 2026-4471',
      'Référence Désignation Qté PU Total',
      'ABC-123 Filtre à huile 4 12.50 50.00',
      'DEF-456 Plaquette de frein 2 45.00 90.00',
      'Total HT 140.00',
      'TVA 8.1% 11.34',
      'Total TTC 151.34',
    ].join('\n');

    const lignes = extraireLignesFacture(texte, 'texte_pdf');
    expect(lignes).toHaveLength(2);
    expect(lignes[0]?.referenceArticle).toBe('ABC-123');
    expect(lignes[1]?.referenceArticle).toBe('DEF-456');
  });

  it('texte sans aucune ligne reconnaissable -> tableau vide, jamais une exception', () => {
    expect(extraireLignesFacture('Rien à voir ici.\nAucun tableau.', 'texte_pdf')).toEqual([]);
  });
});
