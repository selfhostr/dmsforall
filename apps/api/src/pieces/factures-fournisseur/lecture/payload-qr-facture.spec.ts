import { describe, expect, it } from 'vitest';

import {
  construireReferenceQrr,
  encoderChargeUtileQr,
  type DonneesQrFacture,
} from '../../../facturation/qr';

import { centimesDepuisMontantQr, decoderPayloadQrFacture } from './payload-qr-facture';

/** Fixture RÉALISTE : encodée par le même moteur que celui qui émet les QR-factures clients de ce
 *  dépôt (`facturation/qr/encodeur.ts`) — round-trip encode → décode, pas un payload inventé à la
 *  main qui pourrait diverger silencieusement de la vraie structure. */
const DONNEES: DonneesQrFacture = {
  ibanCreancier: 'CH93 0076 2011 6238 5295 7',
  creancier: {
    nom: 'Garage Martin Sàrl',
    rue: 'Rue de la Gare',
    numero: '12',
    npa: '1000',
    localite: 'Lausanne',
    pays: 'CH',
  },
  montantCentimes: 123_45,
  devise: 'CHF',
  debiteur: null,
  reference: null,
  messageNonStructure: 'Facture 2026-00042',
};

describe('centimesDepuisMontantQr', () => {
  it('décode un montant avec décimales', () => {
    expect(centimesDepuisMontantQr('123.45')).toBe(12345);
  });

  it('décode un montant entier sans décimales', () => {
    expect(centimesDepuisMontantQr('50')).toBe(5000);
  });

  it('rend null pour une chaîne vide (QR sans montant, RF-57)', () => {
    expect(centimesDepuisMontantQr('')).toBeNull();
  });

  it('rend null pour un format non conforme', () => {
    expect(centimesDepuisMontantQr('12,50')).toBeNull();
    expect(centimesDepuisMontantQr('abc')).toBeNull();
    expect(centimesDepuisMontantQr('12.5')).toBeNull(); // une seule décimale : hors spec
  });
});

describe('decoderPayloadQrFacture', () => {
  it('décode un payload réel encodé par facturation/qr — round-trip complet', () => {
    const { payload } = encoderChargeUtileQr(DONNEES);
    const resultat = decoderPayloadQrFacture(payload);

    expect(resultat).not.toBeNull();
    expect(resultat?.ibanCreancier).toEqual({ valeur: 'CH9300762011623852957', origine: 'qr' });
    expect(resultat?.nomCreancier).toEqual({ valeur: 'Garage Martin Sàrl', origine: 'qr' });
    expect(resultat?.montantTotalCentimes).toEqual({ valeur: 12345, origine: 'qr' });
    expect(resultat?.devise).toEqual({ valeur: 'CHF', origine: 'qr' });
  });

  it('n’expose PAS de référencePaiement quand l’IBAN n’impose aucune référence (NON)', () => {
    const { payload } = encoderChargeUtileQr(DONNEES);
    const resultat = decoderPayloadQrFacture(payload);
    expect(resultat?.referencePaiement).toBeUndefined();
  });

  it('expose la référence QRR quand l’IBAN est un QR-IBAN', () => {
    const donneesQrIban: DonneesQrFacture = {
      ...DONNEES,
      ibanCreancier: 'CH4431999123000889012', // IID 31999 : plage QR-IBAN
      reference: construireReferenceQrr('12345'), // un QR-IBAN EXIGE une référence QRR
    };
    const { payload, reference } = encoderChargeUtileQr(donneesQrIban);
    const resultat = decoderPayloadQrFacture(payload);
    expect(resultat?.referencePaiement).toEqual({ valeur: reference, origine: 'qr' });
  });

  it('rend null pour un texte qui n’est structurellement pas un Swiss QR Code', () => {
    expect(decoderPayloadQrFacture('bonjour, ceci n’est pas un QR-facture')).toBeNull();
    expect(decoderPayloadQrFacture('SPC\r\n0200')).toBeNull(); // trop court
  });

  it('rend null si le trailer EPD est absent à la position attendue (décalage de champ)', () => {
    const { elements } = encoderChargeUtileQr(DONNEES);
    const decale = [...elements.slice(0, 15), 'CHAMP_EN_TROP', ...elements.slice(15)].join('\r\n');
    expect(decoderPayloadQrFacture(decale)).toBeNull();
  });
});
