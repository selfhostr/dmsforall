import { describe, expect, it } from 'vitest';

import { encoderChargeUtileQr, type DonneesQrFacture } from '../../../facturation/qr';

import { decoderQrFacturePdf } from './decodeur-qr-facture';
import { construirePdfPourTest } from './test-fixtures';

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
  montantCentimes: 15000,
  devise: 'CHF',
  debiteur: null,
  reference: null,
  messageNonStructure: 'Facture 2026-00042',
};

describe('decoderQrFacturePdf — chaîne complète PDF -> image -> jsQR -> payload SPC', () => {
  it('décode un vrai Swiss QR Code embarqué dans un vrai PDF (round-trip complet)', async () => {
    const { payload } = encoderChargeUtileQr(DONNEES);
    const pdf = await construirePdfPourTest({
      lignesTexte: ['Facture fournisseur.'],
      payloadQr: payload,
    });

    const resultat = await decoderQrFacturePdf(pdf);

    expect(resultat.enTete).not.toBeNull();
    expect(resultat.enTete?.ibanCreancier?.valeur).toBe('CH9300762011623852957');
    expect(resultat.enTete?.montantTotalCentimes?.valeur).toBe(15000);
    expect(resultat.diagnostics).toEqual([]);
  });

  it('PDF sans image -> null avec diagnostic, jamais une exception', async () => {
    const pdf = await construirePdfPourTest({ lignesTexte: ['Aucun QR ici.'] });
    const resultat = await decoderQrFacturePdf(pdf);
    expect(resultat.enTete).toBeNull();
    expect(resultat.diagnostics[0]).toContain('aucune image');
  });

  it('image présente mais pas un Swiss QR Code -> null, jamais une valeur devinée', async () => {
    const pdf = await construirePdfPourTest({ payloadQr: 'https://example.com/pas-une-facture' });
    const resultat = await decoderQrFacturePdf(pdf);
    expect(resultat.enTete).toBeNull();
  });
});
