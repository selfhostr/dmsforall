import { describe, expect, it } from 'vitest';

import { ErreurQrFacture } from './erreurs-qr';
import {
  construireReferenceScor,
  estReferenceScorValide,
  formaterReferenceScorPourAffichage,
  validerReferenceScor,
} from './reference-scor';

/**
 * Références RF **publiées par des tiers** : suite de tests de `python-stdnum`
 * (`tests/test_iso11649.doctest`, implémentation indépendante), plus l'exemple canonique de
 * l'article de référence sur le Creditor Reference, donné sous ses deux formes — imprimée
 * (`RF18 5390 0754 7034`) et numérique complétée à 25 caractères
 * (`RF18000000000539007547034`).
 *
 * Même principe que pour le modulo 10 récursif : une clé mod 97-10 calculée sur la chaîne en
 * ordre naturel (au lieu de la chaîne réarrangée) est auto-cohérente et fausse.
 */
const REFERENCES_SCOR_VALIDES_PUBLIEES = [
  'RF18 5390 0754 7034',
  'RF18000000000539007547034',
  'RF03SW3EZRUFBK',
  'RF20QQHM7PAW61EOWO',
  'RF206KCJWVH20',
  'RF888F7P5VQ8TOFTY3LZ',
  'RF23EF4UHBVNPLHKG3HZ9SGGT',
  'RF72YW',
  'RF80I4',
  'RF529',
] as const;

describe('SCOR / ISO 11649 — confrontation à des références publiées', () => {
  it.each(REFERENCES_SCOR_VALIDES_PUBLIEES)('accepte « %s »', (publiee) => {
    expect(estReferenceScorValide(publiee)).toBe(true);
  });

  it('rejette chaque altération d’un caractère de la référence canonique', () => {
    const valide = 'RF18539007547034';

    // Altération des deux chiffres de contrôle.
    for (let cle = 0; cle <= 99; cle += 1) {
      const candidate = `RF${String(cle).padStart(2, '0')}539007547034`;
      expect(estReferenceScorValide(candidate)).toBe(cle === 18);
    }

    // Altération d'un chiffre de la partie utile.
    expect(estReferenceScorValide('RF18539007547035')).toBe(false);
    expect(estReferenceScorValide(valide)).toBe(true);
  });

  it('n’est pas invariant par transposition de deux chiffres', () => {
    // La force du mod 97-10 : la transposition, faute de saisie la plus fréquente, est détectée.
    expect(estReferenceScorValide('RF18539007547043')).toBe(false);
    expect(estReferenceScorValide('RF18539070547034')).toBe(false);
  });
});

describe('construireReferenceScor', () => {
  it('reconstruit la référence canonique depuis sa base', () => {
    expect(construireReferenceScor('539007547034')).toBe('RF18539007547034');
  });

  it('reconstruit la clé de chaque référence publiée depuis sa partie utile', () => {
    for (const publiee of REFERENCES_SCOR_VALIDES_PUBLIEES) {
      const compacte = publiee.replace(/\s/g, '').toUpperCase();
      expect(construireReferenceScor(compacte.slice(4))).toBe(compacte);
    }
  });

  it('produit une référence valide depuis un numéro de facture', () => {
    // 2026-00424 → base alphanumérique « 202600424 ».
    const reference = construireReferenceScor('202600424');
    expect(reference.startsWith('RF')).toBe(true);
    expect(reference.slice(4)).toBe('202600424');
    expect(estReferenceScorValide(reference)).toBe(true);
  });

  it('accepte les lettres et normalise la casse', () => {
    const reference = construireReferenceScor('fa2026 00424');
    expect(reference.slice(4)).toBe('FA202600424');
    expect(estReferenceScorValide(reference)).toBe(true);
  });

  it('refuse une base vide, non alphanumérique ou de plus de 21 caractères', () => {
    expect(() => construireReferenceScor('')).toThrowError(ErreurQrFacture);
    expect(() => construireReferenceScor('2026/00424')).toThrowError(ErreurQrFacture);
    expect(() => construireReferenceScor('A'.repeat(22))).toThrowError(ErreurQrFacture);
  });

  it('accepte exactement 21 caractères de base (25 au total)', () => {
    const reference = construireReferenceScor('A'.repeat(21));
    expect(reference).toHaveLength(25);
    expect(estReferenceScorValide(reference)).toBe(true);
  });
});

describe('validerReferenceScor', () => {
  it('rend la forme compacte en majuscules', () => {
    expect(validerReferenceScor('rf18 5390 0754 7034')).toBe('RF18539007547034');
  });

  it('refuse ce qui ne commence pas par RF + deux chiffres', () => {
    expect(estReferenceScorValide('QR18539007547034')).toBe(false);
    expect(estReferenceScorValide('RFAB539007547034')).toBe(false);
  });

  it('refuse une référence trop longue', () => {
    expect(estReferenceScorValide(`RF18${'5'.repeat(22)}`)).toBe(false);
  });
});

describe('formaterReferenceScorPourAffichage', () => {
  it('groupe par quatre', () => {
    expect(formaterReferenceScorPourAffichage('RF18539007547034')).toBe('RF18 5390 0754 7034');
  });
});
