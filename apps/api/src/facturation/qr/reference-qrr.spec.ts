import { describe, expect, it } from 'vitest';

import { ErreurQrFacture } from './erreurs-qr';
import {
  calculerChiffreControleModulo10Recursif,
  construireReferenceQrr,
  estReferenceQrrValide,
  formaterReferenceQrrPourAffichage,
  validerReferenceQrr,
} from './reference-qrr';

/**
 * Références **publiées par des tiers**, pas produites par cette implémentation.
 *
 * Source : suite de tests de `python-stdnum` (`tests/test_ch_esr.doctest`, module
 * `stdnum.ch.esr`) — une implémentation indépendante du modulo 10 récursif, dont les jeux de
 * valeurs proviennent de bulletins de versement réels ; plus la référence d'exemple des
 * Implementation Guidelines QR-bill (`21 00000 00003 13947 14300 09017`), qu'on retrouve
 * identique dans les charges utiles d'exemple publiées par SIX et par `docs.qr-invoice.ch`.
 *
 * C'est le point du module qu'il ne faut surtout pas tester contre soi-même : un modulo 10
 * récursif faux est parfaitement auto-cohérent et passe tous les tests qu'on écrit à partir de
 * sa propre sortie. Il ne survit pas à un jeu de valeurs externes.
 *
 * Les références plus courtes que 27 chiffres sont complétées à gauche par des zéros — neutre
 * pour l'algorithme (`TABLE[0] = 0`, donc un zéro de tête laisse le report inchangé), et c'est
 * ainsi qu'elles s'écrivent sur un bulletin.
 */
const REFERENCES_VALIDES_PUBLIEES = [
  '21 00000 00003 13947 14300 09017',
  '20 12440 00000 46370 02019 05153',
  '1009 76741 00001 47457 50114',
  '1001007711461312058',
  '361610000000000020190704093',
  '31 23711 80610 58530 00071 92101',
  '18 78583',
  '36 13030 00000 00000 00000 04142',
  '01 73575 51208 21125 03398 69724',
  '2101315000320229184501',
  '90 00170 00000 00214 95962 25686',
  '432130000000000573490016096',
  '201244000000463700201900994',
  '32 29790 00000 19151 00002 79617',
] as const;

/** Complète à 27 chiffres, comme sur un bulletin. */
const a27Chiffres = (reference: string): string => reference.replace(/\s/g, '').padStart(27, '0');

describe('modulo 10 récursif — confrontation à des références publiées', () => {
  it.each(REFERENCES_VALIDES_PUBLIEES)('reproduit le chiffre de contrôle de « %s »', (publiee) => {
    const complete = a27Chiffres(publiee);
    const base = complete.slice(0, 26);
    const chiffreAttendu = Number(complete.charAt(26));

    expect(calculerChiffreControleModulo10Recursif(base)).toBe(chiffreAttendu);
    expect(validerReferenceQrr(complete)).toBe(complete);
  });

  it('rejette la référence d’exemple dont le dernier chiffre a été altéré (7 → 6)', () => {
    // Contre-exemple publié par la même suite de tests : InvalidChecksum attendu.
    expect(estReferenceQrrValide('210000000003139471430009016')).toBe(false);
    expect(() => validerReferenceQrr('210000000003139471430009016')).toThrowError(ErreurQrFacture);
  });

  it('détecte chacune des neuf altérations du dernier chiffre de la référence d’exemple', () => {
    const valide = '210000000003139471430009017';
    const base = valide.slice(0, 26);

    for (let chiffre = 0; chiffre <= 9; chiffre += 1) {
      const candidate = `${base}${chiffre}`;
      expect(estReferenceQrrValide(candidate)).toBe(chiffre === 7);
    }
  });

  it('n’est pas l’algorithme de Luhn — un modulo 10 « ordinaire » donnerait un autre chiffre', () => {
    // Somme simple des chiffres de la base : 2+1+3+1+3+9+4+7+1+4+3+9 = 47 ; un modulo 10 naïf
    // rendrait (10 − 47 % 10) % 10 = 3, et non 7. Ce test fige la différence : si quelqu'un
    // remplace un jour l'automate par un calcul « simplifié », il échoue ici.
    const base = '21000000000313947143000901';
    expect(calculerChiffreControleModulo10Recursif(base)).toBe(7);
    expect(calculerChiffreControleModulo10Recursif(base)).not.toBe(3);
  });

  it('traite les zéros de tête comme neutres', () => {
    expect(calculerChiffreControleModulo10Recursif('0')).toBe(0);
    expect(calculerChiffreControleModulo10Recursif('00000000000000000000000000')).toBe(0);
    expect(calculerChiffreControleModulo10Recursif('187858')).toBe(
      calculerChiffreControleModulo10Recursif('00000000000000000000187858'),
    );
  });
});

describe('construireReferenceQrr', () => {
  it('complète à 26 chiffres et suffixe le chiffre de contrôle', () => {
    const reference = construireReferenceQrr('313947143000901');
    expect(reference).toHaveLength(27);
    expect(reference.slice(0, 26)).toBe('00000000000313947143000901');
    expect(estReferenceQrrValide(reference)).toBe(true);
  });

  it('produit une référence valide pour un numéro de facture usuel', () => {
    // 2026-00424 → base « 202600424 » côté facturation.
    const reference = construireReferenceQrr('202600424');
    expect(reference).toHaveLength(27);
    expect(reference.slice(0, 26)).toBe('00000000000000000202600424');
    expect(estReferenceQrrValide(reference)).toBe(true);
  });

  it('reconstruit exactement la référence d’exemple depuis sa base', () => {
    expect(construireReferenceQrr('21000000000313947143000901')).toBe(
      '210000000003139471430009017',
    );
  });

  it('refuse une base non numérique, vide, ou trop longue', () => {
    expect(() => construireReferenceQrr('')).toThrowError(ErreurQrFacture);
    expect(() => construireReferenceQrr('2026-00424')).toThrowError(ErreurQrFacture);
    expect(() => construireReferenceQrr('1'.repeat(27))).toThrowError(ErreurQrFacture);
  });

  it('refuse une référence entièrement nulle', () => {
    expect(() => construireReferenceQrr('0')).toThrowError(ErreurQrFacture);
    expect(() => construireReferenceQrr('0'.repeat(26))).toThrowError(ErreurQrFacture);
    expect(estReferenceQrrValide('0'.repeat(27))).toBe(false);
  });
});

describe('validerReferenceQrr', () => {
  it('accepte la forme espacée et rend la forme compacte', () => {
    expect(validerReferenceQrr('21 00000 00003 13947 14300 09017')).toBe(
      '210000000003139471430009017',
    );
  });

  it('refuse une longueur différente de 27', () => {
    expect(estReferenceQrrValide('21000000000313947143000901')).toBe(false);
    expect(estReferenceQrrValide('2100000000031394714300090178')).toBe(false);
  });

  it('refuse une référence contenant des lettres', () => {
    expect(estReferenceQrrValide('21000000000313947143000TE45')).toBe(false);
  });
});

describe('formaterReferenceQrrPourAffichage', () => {
  it('groupe en 2 puis 5 × 5', () => {
    expect(formaterReferenceQrrPourAffichage('210000000003139471430009017')).toBe(
      '21 00000 00003 13947 14300 09017',
    );
  });
});
