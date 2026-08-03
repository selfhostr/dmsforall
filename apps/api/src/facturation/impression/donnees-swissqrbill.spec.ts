import { describe, expect, it } from 'vitest';
import type { BlocPaiementQrFige } from '@dfa/shared';

import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import {
  construireDonneesSwissQrBill,
  langueSwissQrBill,
  validerLangueFigee,
} from './donnees-swissqrbill';

const CREANCIER_BASE: BlocPaiementQrFige['creancier'] = {
  iban: 'CH4431999123000889012',
  estQrIban: true,
  nom: 'Garage Martin SA',
  adresse: { rue: 'Route de Riddes', numero: '42', npa: '1950', localite: 'Sion', pays: 'CH' },
};

function blocQr(overrides: Partial<BlocPaiementQrFige> = {}): BlocPaiementQrFige {
  return {
    qrPayload: 'peu importe pour ce test',
    qrPayloadSha256: 'peu importe',
    typeReferenceQr: 'qrr',
    qrReference: '000000000020261000000000019',
    qrMontantCentimes: 7000,
    qrDevise: 'CHF',
    qrLangue: 'fr',
    creancier: CREANCIER_BASE,
    debiteur: null,
    ...overrides,
  };
}

describe('construireDonneesSwissQrBill', () => {
  it('mappe le cas QRR + QR-IBAN, débiteur absent (RF-59), CHF — cas de la facture 2026-00002', () => {
    const data = construireDonneesSwissQrBill(blocQr(), '2026-00002');
    expect(data).toEqual({
      amount: 70,
      currency: 'CHF',
      creditor: {
        account: 'CH4431999123000889012',
        name: 'Garage Martin SA',
        address: 'Route de Riddes',
        buildingNumber: '42',
        zip: '1950',
        city: 'Sion',
        country: 'CH',
      },
      reference: '000000000020261000000000019',
      message: 'Facture 2026-00002',
    });
    expect(data.debtor).toBeUndefined();
  });

  it('mappe le débiteur quand il est présent', () => {
    const data = construireDonneesSwissQrBill(
      blocQr({
        debiteur: {
          nom: 'Jean Dupont',
          rue: 'Chemin des Fleurs',
          numero: '3',
          npa: '1000',
          localite: 'Lausanne',
          pays: 'CH',
        },
      }),
      '2026-00010',
    );
    expect(data.debtor).toEqual({
      name: 'Jean Dupont',
      address: 'Chemin des Fleurs',
      buildingNumber: '3',
      zip: '1000',
      city: 'Lausanne',
      country: 'CH',
    });
  });

  it('numéro de rue absent (null) devient undefined, jamais une chaîne vide', () => {
    const data = construireDonneesSwissQrBill(
      blocQr({
        creancier: { ...CREANCIER_BASE, adresse: { ...CREANCIER_BASE.adresse, numero: null } },
      }),
      '2026-00002',
    );
    expect(data.creditor.buildingNumber).toBeUndefined();
  });

  it('SCOR + IBAN ordinaire : reference propagée telle quelle', () => {
    const data = construireDonneesSwissQrBill(
      blocQr({ typeReferenceQr: 'scor', qrReference: 'RF18539007547034' }),
      '2026-00003',
    );
    expect(data.reference).toBe('RF18539007547034');
  });

  it("sans référence (typeReferenceQr = 'non') : champ reference absent, pas une chaîne vide", () => {
    const data = construireDonneesSwissQrBill(
      blocQr({ typeReferenceQr: 'non', qrReference: null }),
      '2026-00004',
    );
    expect(data.reference).toBeUndefined();
  });

  it('devise EUR propagée', () => {
    const data = construireDonneesSwissQrBill(blocQr({ qrDevise: 'EUR' }), '2026-00005');
    expect(data.currency).toBe('EUR');
  });

  it('montant en centimes converti en unité monétaire pleine, sans perte', () => {
    expect(construireDonneesSwissQrBill(blocQr({ qrMontantCentimes: 123456 }), 'X').amount).toBe(
      1234.56,
    );
    expect(construireDonneesSwissQrBill(blocQr({ qrMontantCentimes: 5 }), 'X').amount).toBe(0.05);
  });
});

describe('validerLangueFigee / langueSwissQrBill', () => {
  it.each([
    ['fr', 'FR'],
    ['de', 'DE'],
    ['it', 'IT'],
  ] as const)('%s -> %s', (entree, attendu) => {
    expect(validerLangueFigee(entree)).toBe(entree);
    expect(langueSwissQrBill(entree)).toBe(attendu);
  });

  it('refuse une langue inattendue (incohérence de données)', () => {
    expect(() => validerLangueFigee('en')).toThrow(ErreurMetier);
    expect(() => langueSwissQrBill('rm')).toThrow(ErreurMetier);
  });
});
