import { describe, expect, it } from 'vitest';

import { ErreurQrFacture } from './erreurs-qr';
import { determinerTypeReference, estQrIban, extraireIid, validerIbanCreancier } from './iban';
import { validerReferenceQrr } from './reference-qrr';
import { validerReferenceScor } from './reference-scor';

/** QR-IBAN de l'exemple des Implementation Guidelines — IID 31999, borne haute de la plage. */
const QR_IBAN = 'CH4431999123000889012';
/** QR-IBAN à la borne basse de la plage réservée — IID 30000. */
const QR_IBAN_BORNE_BASSE = 'CH7230000000123456789';
/** IBAN ordinaire — IID 00762 (PostFinance). */
const IBAN_ORDINAIRE = 'CH9300762011623852957';
/** IID 29999 et 32000 : les deux voisins immédiats de la plage QR, qui ne doivent PAS basculer. */
const IBAN_IID_29999 = 'CH6429999000123456789';
const IBAN_IID_32000 = 'CH6732000000123456789';

const QRR = '210000000003139471430009017';
const SCOR = 'RF18539007547034';

const outils = { validerQrr: validerReferenceQrr, validerScor: validerReferenceScor };

describe('validerIbanCreancier', () => {
  it('accepte un IBAN CH ou LI valide et rend la forme compacte', () => {
    expect(validerIbanCreancier('CH44 3199 9123 0008 8901 2')).toBe(QR_IBAN);
    expect(validerIbanCreancier(IBAN_ORDINAIRE)).toBe(IBAN_ORDINAIRE);
    expect(validerIbanCreancier('LI5808800000002345678')).toBe('LI5808800000002345678');
  });

  it('refuse un IBAN dont la clé ISO 7064 est fausse', () => {
    // Un seul chiffre de clé altéré (44 → 45) : c'est exactement la faute de frappe qu'on veut
    // attraper au paramétrage, pas trois semaines plus tard.
    expect(() => validerIbanCreancier('CH4531999123000889012')).toThrowError(ErreurQrFacture);
  });

  it('refuse un IBAN étranger hors CH/LI', () => {
    expect(() => validerIbanCreancier('DE89370400440532013000')).toThrowError(ErreurQrFacture);
  });

  it('refuse une longueur incorrecte', () => {
    expect(() => validerIbanCreancier('CH443199912300088901')).toThrowError(ErreurQrFacture);
    expect(() => validerIbanCreancier('CH44319991230008890123')).toThrowError(ErreurQrFacture);
  });

  it('refuse une chaîne mal formée', () => {
    expect(() => validerIbanCreancier('')).toThrowError(ErreurQrFacture);
    expect(() => validerIbanCreancier('CHXX31999123000889012')).toThrowError(ErreurQrFacture);
  });
});

describe('estQrIban — la plage IID 30000-31999 et ses bornes', () => {
  it.each([
    [QR_IBAN, 31_999, true],
    [QR_IBAN_BORNE_BASSE, 30_000, true],
    [IBAN_IID_29999, 29_999, false],
    [IBAN_IID_32000, 32_000, false],
    [IBAN_ORDINAIRE, 762, false],
  ])('%s → IID %i, QR-IBAN : %s', (iban, iidAttendu, estQr) => {
    const valide = validerIbanCreancier(iban);
    expect(extraireIid(valide)).toBe(iidAttendu);
    expect(estQrIban(valide)).toBe(estQr);
  });
});

describe('determinerTypeReference — le type découle de l’IBAN, jamais d’un choix (RF-55)', () => {
  it('QR-IBAN + QRR → QRR', () => {
    expect(determinerTypeReference(QR_IBAN, QRR, outils)).toEqual({
      type: 'QRR',
      reference: QRR,
    });
  });

  it('QR-IBAN + référence espacée → QRR compacte', () => {
    expect(
      determinerTypeReference(QR_IBAN, '21 00000 00003 13947 14300 09017', outils).reference,
    ).toBe(QRR);
  });

  it('QR-IBAN sans référence → refusé', () => {
    // Une facture sur QR-IBAN sans référence n'est pas rapprochable : la banque la rejette.
    for (const vide of [null, undefined, '', '   ']) {
      expect(() => determinerTypeReference(QR_IBAN, vide, outils)).toThrowError(ErreurQrFacture);
    }
  });

  it('QR-IBAN + SCOR → refusé', () => {
    expect(() => determinerTypeReference(QR_IBAN, SCOR, outils)).toThrowError(ErreurQrFacture);
  });

  it('IBAN ordinaire + SCOR → SCOR', () => {
    expect(determinerTypeReference(IBAN_ORDINAIRE, SCOR, outils)).toEqual({
      type: 'SCOR',
      reference: SCOR,
    });
  });

  it('IBAN ordinaire sans référence → NON', () => {
    expect(determinerTypeReference(IBAN_ORDINAIRE, null, outils)).toEqual({
      type: 'NON',
      reference: '',
    });
  });

  it('IBAN ordinaire + QRR → refusé', () => {
    expect(() => determinerTypeReference(IBAN_ORDINAIRE, QRR, outils)).toThrowError(
      ErreurQrFacture,
    );
  });

  it('nomme le code d’erreur du couple incompatible', () => {
    try {
      determinerTypeReference(IBAN_ORDINAIRE, QRR, outils);
      expect.unreachable('un IBAN ordinaire ne peut pas porter une QRR');
    } catch (erreur) {
      expect((erreur as ErreurQrFacture).code).toBe('TYPE_REFERENCE_INCOMPATIBLE_IBAN');
    }
  });

  it('propage l’erreur de chiffre de contrôle d’une QRR fausse', () => {
    try {
      determinerTypeReference(QR_IBAN, '210000000003139471430009016', outils);
      expect.unreachable('le chiffre de contrôle est faux');
    } catch (erreur) {
      expect((erreur as ErreurQrFacture).code).toBe('REFERENCE_QRR_INVALIDE');
    }
  });
});
