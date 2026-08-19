import { describe, expect, it } from 'vitest';

import { ErreurQrFacture } from './erreurs-qr';
import { encoderMontantOptionnel, formaterMontantPayload, validerDevise } from './montant';

describe('formaterMontantPayload — centimes entiers vers la représentation du payload', () => {
  it.each([
    [1, '0.01'],
    [5, '0.05'],
    [10, '0.10'],
    [100, '1.00'],
    [105, '1.05'],
    [150, '1.50'],
    // CF-01 : la facture de référence du modèle documentaire.
    [56_660, '566.60'],
    // CF-05 : les deux sens de l'arrondi espèces, une fois arrondis en amont.
    [20_430, '204.30'],
    [20_435, '204.35'],
    // L'exemple des Implementation Guidelines.
    [194_975, '1949.75'],
    [1_000_000, '10000.00'],
    [99_999_999_999, '999999999.99'],
  ])('%i centimes → « %s »', (centimes, attendu) => {
    expect(formaterMontantPayload(centimes)).toBe(attendu);
  });

  it('n’insère aucun séparateur de milliers', () => {
    expect(formaterMontantPayload(123_456_789)).toBe('1234567.89');
    expect(formaterMontantPayload(123_456_789)).not.toContain("'");
    expect(formaterMontantPayload(123_456_789)).not.toContain(',');
  });

  it('ne perd jamais un centime, sur toute la plage des unités', () => {
    // Le piège que ce module existe pour éviter : `(c / 100).toFixed(2)` est faux pour certaines
    // valeurs en virgule flottante. Ici, aucun flottant n'intervient — on le prouve sur 20 000
    // valeurs consécutives dont on relit les centimes (borné pour rester loin du délai de 5 s
    // des tests unitaires, y compris sur un runner CI froid). Boucle en pur JS pour éviter
    // 40 000 appels expect()/matcher ; vérifications collectées, verdict une fois.
    const erreurs: string[] = [];
    for (let centimes = 1; centimes <= 20_000; centimes += 1) {
      const formate = formaterMontantPayload(centimes);
      const [francs = '', decimales = ''] = formate.split('.');
      const recompose = Number(francs) * 100 + Number(decimales);

      if (recompose !== centimes) {
        erreurs.push(`centimes=${centimes}: recompose=${recompose}`);
      }
      if (decimales.length !== 2) {
        erreurs.push(`centimes=${centimes}: decimales.length=${decimales.length}`);
      }
    }
    expect(erreurs).toHaveLength(0);
  });

  it('refuse un montant non entier, négatif, nul ou hors bornes', () => {
    expect(() => formaterMontantPayload(12.5)).toThrowError(ErreurQrFacture);
    expect(() => formaterMontantPayload(-1)).toThrowError(ErreurQrFacture);
    expect(() => formaterMontantPayload(0)).toThrowError(ErreurQrFacture);
    expect(() => formaterMontantPayload(100_000_000_000)).toThrowError(ErreurQrFacture);
    expect(() => formaterMontantPayload(Number.NaN)).toThrowError(ErreurQrFacture);
  });

  it('nomme le code d’erreur attendu', () => {
    try {
      formaterMontantPayload(0);
      expect.unreachable('un montant nul doit être refusé');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurQrFacture);
      expect((erreur as ErreurQrFacture).code).toBe('MONTANT_INVALIDE');
    }
  });
});

describe('encoderMontantOptionnel', () => {
  it('rend une chaîne vide quand aucun montant n’est imposé (RF-57)', () => {
    expect(encoderMontantOptionnel(null)).toBe('');
    expect(encoderMontantOptionnel(undefined)).toBe('');
  });

  it('refuse 0 plutôt que de l’assimiler à « pas de montant »', () => {
    expect(() => encoderMontantOptionnel(0)).toThrowError(ErreurQrFacture);
  });
});

describe('validerDevise', () => {
  it('accepte CHF et EUR, en toute casse', () => {
    expect(validerDevise('CHF')).toBe('CHF');
    expect(validerDevise('chf')).toBe('CHF');
    expect(validerDevise(' eur ')).toBe('EUR');
  });

  it('refuse toute autre devise (RF-58)', () => {
    for (const devise of ['USD', 'GBP', 'JPY', '']) {
      expect(() => validerDevise(devise)).toThrowError(ErreurQrFacture);
    }
  });
});
