import { describe, expect, it, vi } from 'vitest';

import { encoderChargeUtileQr, type DonneesQrFacture } from '../../../facturation/qr';

import { ServiceOrchestrateurLectureFacture } from './orchestrateur-lecture';
import { ErreurOcrTexteFacture, type PortOcrTexteFacture } from './port-ocr-texte';
import { construirePdfPourTest, construirePdfVidePourTest } from './test-fixtures';

const DONNEES_QR: DonneesQrFacture = {
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
  messageNonStructure: null,
};

function ocrJamaisAppele(): PortOcrTexteFacture {
  return { reconnaitre: vi.fn().mockRejectedValue(new Error('ne doit jamais être appelé')) };
}

describe('ServiceOrchestrateurLectureFacture', () => {
  it('texte présent : QR + lignes extraites du texte, OCR jamais sollicité', async () => {
    const { payload } = encoderChargeUtileQr(DONNEES_QR);
    const pdf = await construirePdfPourTest({
      lignesTexte: ['ABC-123 Filtre à huile 4 12.50 50.00'],
      payloadQr: payload,
    });
    const ocr = ocrJamaisAppele();
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);

    expect(resultat.enTete.ibanCreancier?.origine).toBe('qr');
    expect(resultat.lignes).toHaveLength(1);
    expect(resultat.lignes[0]?.origine).toBe('texte_pdf');
    expect(ocr.reconnaitre).not.toHaveBeenCalled();
  });

  it('aucun texte : repli OCR sollicité, ses lignes portent origine "ocr"', async () => {
    const pdf = await construirePdfVidePourTest();
    const ocr: PortOcrTexteFacture = {
      reconnaitre: vi.fn().mockResolvedValue({
        texte: 'XYZ-9 Joint de culasse 1 30.00 30.00',
        confiance: 72,
        dureeMs: 500,
      }),
    };
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);

    expect(ocr.reconnaitre).toHaveBeenCalledOnce();
    expect(resultat.lignes).toHaveLength(1);
    expect(resultat.lignes[0]?.origine).toBe('ocr');
  });

  it('OCR non configuré (dernier recours indisponible) : diagnostic, jamais une exception qui casse le dépôt', async () => {
    const pdf = await construirePdfVidePourTest();
    const ocr: PortOcrTexteFacture = {
      reconnaitre: vi
        .fn()
        .mockRejectedValue(new ErreurOcrTexteFacture('MOTEUR_NON_CONFIGURE', 'non configuré')),
    };
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);

    expect(resultat.lignes).toEqual([]);
    expect(resultat.diagnostics.some((d) => d.includes('MOTEUR_NON_CONFIGURE'))).toBe(true);
  });

  it('le QR (certain) n’est jamais écrasé par une valeur ultérieure moins certaine', async () => {
    const { payload } = encoderChargeUtileQr(DONNEES_QR);
    const pdf = await construirePdfPourTest({
      lignesTexte: ['Rien qui ressemble à une ligne de facture.'],
      payloadQr: payload,
    });
    const ocr = ocrJamaisAppele();
    const service = new ServiceOrchestrateurLectureFacture(ocr);

    const resultat = await service.lire(pdf);
    expect(resultat.enTete.montantTotalCentimes).toEqual({ valeur: 15000, origine: 'qr' });
  });
});
