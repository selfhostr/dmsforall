import { describe, expect, it } from 'vitest';

import {
  formaterDateWinbiz,
  formaterLibelleWinbiz,
  formaterMontantWinbiz,
  formaterPieceWinbiz,
  formaterTauxWinbiz,
  nettoyerTexteWinbiz,
  verifierLongueurCompteWinbiz,
} from './winbiz-champs';
import { ErreurExportWinbiz } from './winbiz.erreurs';

describe('formaterDateWinbiz', () => {
  it('convertit aaaa-mm-jj en jj.mm.aaaa', () => {
    expect(formaterDateWinbiz('2026-07-29')).toBe('29.07.2026');
    expect(formaterDateWinbiz('2026-01-01')).toBe('01.01.2026');
    expect(formaterDateWinbiz('2025-02-01')).toBe('01.02.2025'); // date de l'exemple officiel EF-15
  });

  it('rejette une date mal formée', () => {
    expect(() => formaterDateWinbiz('29.07.2026')).toThrow(ErreurExportWinbiz);
    expect(() => formaterDateWinbiz('2026-7-29')).toThrow(ErreurExportWinbiz);
    expect(() => formaterDateWinbiz('')).toThrow(ErreurExportWinbiz);
  });
});

describe('formaterMontantWinbiz — valeurs EXACTES en centimes, décimales inutiles supprimées', () => {
  it('reproduit fidèlement les deux lignes de l’exemple officiel ecr_standardv6.csv', () => {
    expect(formaterMontantWinbiz(10810)).toBe('108.1'); // 108.10 CHF
    expect(formaterMontantWinbiz(10000)).toBe('100'); // 100.00 CHF, aucune décimale
  });

  it('conserve deux décimales quand elles sont significatives', () => {
    expect(formaterMontantWinbiz(10801)).toBe('108.01');
    expect(formaterMontantWinbiz(1)).toBe('0.01');
    expect(formaterMontantWinbiz(10850)).toBe('108.5');
  });

  it('gère zéro et les grands montants sans perte', () => {
    expect(formaterMontantWinbiz(0)).toBe('0');
    expect(formaterMontantWinbiz(100000000)).toBe('1000000'); // CHF 1'000'000.00 (plafond ligne_document)
    expect(formaterMontantWinbiz(100000001)).toBe('1000000.01');
  });

  it('rejette un montant négatif — le signe doit venir de « sens », jamais du montant', () => {
    expect(() => formaterMontantWinbiz(-100)).toThrow(ErreurExportWinbiz);
  });

  it('rejette un montant non entier', () => {
    expect(() => formaterMontantWinbiz(10.5)).toThrow(ErreurExportWinbiz);
    expect(() => formaterMontantWinbiz(Number.NaN)).toThrow(ErreurExportWinbiz);
  });
});

describe('formaterTauxWinbiz — les trois taux TVA 2026', () => {
  it('formate les taux réels au dixième de pourcent, littéralement comme l’exemple officiel', () => {
    expect(formaterTauxWinbiz(81)).toBe('8.1'); // taux normal
    expect(formaterTauxWinbiz(26)).toBe('2.6'); // taux réduit
    expect(formaterTauxWinbiz(38)).toBe('3.8'); // taux hébergement
    expect(formaterTauxWinbiz(0)).toBe('0'); // exonéré / exclu
  });
});

describe('nettoyerTexteWinbiz', () => {
  it('remplace « ; » (le séparateur de champ) et CR/LF par une espace', () => {
    expect(nettoyerTexteWinbiz('Pare-choc; avant\r\nPeint', 200).valeur).toBe(
      'Pare-choc avant Peint',
    );
  });

  it('réduit les espaces multiples et rogne les bords', () => {
    expect(nettoyerTexteWinbiz('  trop   d’espaces   ', 200).valeur).toBe('trop d’espaces');
  });

  it('tronque à la longueur maximale et le signale', () => {
    const resultat = nettoyerTexteWinbiz('abcdefghij', 5);
    expect(resultat).toEqual({ valeur: 'abcde', tronque: true });
  });

  it('ne signale rien quand la longueur tient', () => {
    const resultat = nettoyerTexteWinbiz('abc', 5);
    expect(resultat).toEqual({ valeur: 'abc', tronque: false });
  });
});

describe('formaterPieceWinbiz — troncature depuis la DROITE (10 caractères, EF-13)', () => {
  it('ne touche pas une référence qui tient dans 10 caractères', () => {
    expect(formaterPieceWinbiz('FA26-0007')).toEqual({ valeur: 'FA26-0007', tronque: false });
  });

  it('conserve les 10 DERNIERS caractères d’une référence trop longue', () => {
    // "FA-2026-00123" fait 13 caractères — un numéro DFA réaliste (document_vente.numero
    // autorise jusqu'à 20 caractères), plus long que les 10 admis par WinBIZ.
    const resultat = formaterPieceWinbiz('FA-2026-00123');
    expect(resultat.valeur).toBe('2026-00123');
    expect(resultat.valeur).toHaveLength(10);
    expect(resultat.tronque).toBe(true);
  });

  it('paiement multi-factures : le suffixe « +N » est conservé, le numéro est tronqué pour tenir en 10', () => {
    expect(formaterPieceWinbiz('FA-2026-00108+2')).toEqual({ valeur: '26-00108+2', tronque: true });
    expect(formaterPieceWinbiz('FA-2026-00108+12')).toEqual({
      valeur: '6-00108+12',
      tronque: true,
    });
    expect(formaterPieceWinbiz('2026-1+3')).toEqual({ valeur: '2026-1+3', tronque: false });
  });

  it('assainit avant de tronquer (un « ; » ne doit jamais survivre dans Pièce)', () => {
    const resultat = formaterPieceWinbiz('FA;2026;00123');
    expect(resultat.valeur).not.toContain(';');
  });
});

describe('formaterLibelleWinbiz', () => {
  it('tronque à 100 caractères', () => {
    const long = 'x'.repeat(150);
    const resultat = formaterLibelleWinbiz(long);
    expect(resultat.valeur).toHaveLength(100);
    expect(resultat.tronque).toBe(true);
  });
});

describe('verifierLongueurCompteWinbiz', () => {
  it('accepte un compte du plan comptable PME suisse standard', () => {
    expect(verifierLongueurCompteWinbiz('1100')).toBe('1100');
    expect(verifierLongueurCompteWinbiz(' 3200 ')).toBe('3200');
  });

  it('refuse un compte vide ou plus long que 12 caractères plutôt que de le tronquer', () => {
    expect(() => verifierLongueurCompteWinbiz('')).toThrow(ErreurExportWinbiz);
    expect(() => verifierLongueurCompteWinbiz('   ')).toThrow(ErreurExportWinbiz);
    expect(() => verifierLongueurCompteWinbiz('1234567890123')).toThrow(ErreurExportWinbiz); // 13
  });
});
