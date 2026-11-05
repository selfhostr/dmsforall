/**
 * Suite de non-régression DI-3/MD-77 : transforme la « coïncidence de mapping » vérifiée une fois
 * par le lot précédent (facture 2026-00002, débiteur absent) en invariant, sur plusieurs
 * combinaisons (QRR + QR-IBAN, SCOR + IBAN ordinaire, sans référence, débiteur présent/absent,
 * CHF/EUR) — consigne explicite du coordinateur.
 *
 * Construit le payload figé avec LE VRAI ENCODEUR D'ÉMISSION (`facturation/qr/encodeur.ts`,
 * `encoderChargeUtileQr`) plutôt qu'un payload écrit à la main : c'est EXACTEMENT ce que
 * `qr-emission.ts` produit et fige en base à l'émission d'une facture réelle. Le test prouve donc
 * l'invariant sur le VRAI chemin de données, pas sur une fixture arbitraire.
 */

import { describe, expect, it } from 'vitest';
import type { BlocPaiementQrFige } from '@dfa/shared';

import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import {
  construireReferenceQrr,
  encoderChargeUtileQr,
  type AdresseStructuree,
  type DonneesQrFacture,
} from '../qr';
import { construireDonneesSwissQrBill } from './donnees-swissqrbill';
import { verifierEquivalencePayload } from './verification-payload-qr';

const CREANCIER_2026_00002: AdresseStructuree = {
  nom: 'Garage Martin SA',
  rue: 'Route de Riddes',
  numero: '42',
  npa: '1950',
  localite: 'Sion',
  pays: 'CH',
};

/** Construit, à partir des mêmes `DonneesQrFacture` que `qr-emission.ts` utiliserait, à la fois le
 *  payload FIGÉ (vrai encodeur d'émission) et le `BlocPaiementQrFige` correspondant — le format
 *  que `ServiceDocumentsVente.obtenirComplet` exposerait pour une facture réellement émise. */
function figerCas(donnees: DonneesQrFacture): {
  readonly payloadFige: string;
  readonly blocQr: BlocPaiementQrFige;
} {
  const resultat = encoderChargeUtileQr(donnees);
  const blocQr: BlocPaiementQrFige = {
    qrPayload: resultat.payload,
    qrPayloadSha256: 'non pertinent pour ce test',
    typeReferenceQr: resultat.typeReference.toLowerCase() as BlocPaiementQrFige['typeReferenceQr'],
    qrReference: resultat.reference.length > 0 ? resultat.reference : null,
    qrMontantCentimes: donnees.montantCentimes ?? 0,
    qrDevise: resultat.devise as BlocPaiementQrFige['qrDevise'],
    qrLangue: 'fr',
    creancier: {
      iban: donnees.ibanCreancier.replace(/\s+/g, '').toUpperCase(),
      estQrIban: true,
      nom: donnees.creancier.nom,
      adresse: {
        rue: donnees.creancier.rue ?? '',
        numero: donnees.creancier.numero ?? null,
        npa: donnees.creancier.npa ?? '',
        localite: donnees.creancier.localite ?? '',
        pays: donnees.creancier.pays ?? 'CH',
      },
    },
    debiteur:
      resultat.blocDebiteurEmis && donnees.debiteur
        ? {
            nom: donnees.debiteur.nom,
            rue: donnees.debiteur.rue ?? '',
            numero: donnees.debiteur.numero ?? null,
            npa: donnees.debiteur.npa ?? '',
            localite: donnees.debiteur.localite ?? '',
            pays: donnees.debiteur.pays ?? 'CH',
          }
        : null,
  };
  return { payloadFige: resultat.payload, blocQr };
}

describe('verifierEquivalencePayload — invariant DI-3/MD-77, plusieurs combinaisons', () => {
  it('QRR + QR-IBAN, débiteur ABSENT (RF-59), CHF — cas réel de la facture 2026-00002', () => {
    const { payloadFige, blocQr } = figerCas({
      ibanCreancier: 'CH4431999123000889012',
      creancier: CREANCIER_2026_00002,
      montantCentimes: 7000,
      devise: 'CHF',
      debiteur: null,
      reference: '000000000020261000000000019',
      messageNonStructure: 'Facture 2026-00002',
    });

    const data = construireDonneesSwissQrBill(blocQr, '2026-00002');
    expect(() => verifierEquivalencePayload(data, payloadFige, 'doc-2026-00002')).not.toThrow();
  });

  it('QRR + QR-IBAN, débiteur PRÉSENT, CHF', () => {
    const debiteur: AdresseStructuree = {
      nom: 'Jean Dupont',
      rue: 'Chemin des Fleurs',
      numero: '3',
      npa: '1000',
      localite: 'Lausanne',
      pays: 'CH',
    };
    const { payloadFige, blocQr } = figerCas({
      ibanCreancier: 'CH4431999123000889012',
      creancier: CREANCIER_2026_00002,
      montantCentimes: 15000,
      devise: 'CHF',
      debiteur,
      // Chiffre de contrôle modulo 10 récursif calculé par le vrai constructeur — une référence
      // QRR ne se tape pas à la main, sa clé de contrôle en dépend entièrement.
      reference: construireReferenceQrr('00000000002026100000000002'),
      messageNonStructure: 'Facture 2026-00010',
    });

    const data = construireDonneesSwissQrBill(blocQr, '2026-00010');
    expect(() => verifierEquivalencePayload(data, payloadFige, 'doc-2026-00010')).not.toThrow();
  });

  it('SCOR + IBAN ORDINAIRE (non QR-IBAN), débiteur absent, EUR', () => {
    // IBAN suisse ordinaire (IID hors plage QR-IBAN 30000-31999) — `determinerTypeReference`
    // choisit SCOR. IBAN valide arbitraire à clé modulo-97 correcte pour ce test.
    const { payloadFige, blocQr } = figerCas({
      ibanCreancier: 'CH9300762011623852957',
      creancier: CREANCIER_2026_00002,
      montantCentimes: 250000,
      devise: 'EUR',
      debiteur: null,
      reference: 'RF18539007547034',
      messageNonStructure: 'Facture 2026-00099',
    });

    const data = construireDonneesSwissQrBill(blocQr, '2026-00099');
    expect(() => verifierEquivalencePayload(data, payloadFige, 'doc-2026-00099')).not.toThrow();
  });

  it('SANS RÉFÉRENCE (IBAN ordinaire, aucune référence fournie), débiteur présent, CHF', () => {
    const debiteur: AdresseStructuree = {
      nom: 'Marie Rossi',
      rue: 'Via Nassa',
      numero: '10',
      npa: '6900',
      localite: 'Lugano',
      pays: 'CH',
    };
    const { payloadFige, blocQr } = figerCas({
      ibanCreancier: 'CH9300762011623852957',
      creancier: CREANCIER_2026_00002,
      montantCentimes: 9999,
      devise: 'CHF',
      debiteur,
      reference: null,
      messageNonStructure: 'Facture 2026-00100',
    });

    const data = construireDonneesSwissQrBill(blocQr, '2026-00100');
    expect(() => verifierEquivalencePayload(data, payloadFige, 'doc-2026-00100')).not.toThrow();
  });

  it('REFUS sur divergence artificielle : montant modifié après figeage', () => {
    const { payloadFige, blocQr } = figerCas({
      ibanCreancier: 'CH4431999123000889012',
      creancier: CREANCIER_2026_00002,
      montantCentimes: 7000,
      devise: 'CHF',
      debiteur: null,
      reference: '000000000020261000000000019',
      messageNonStructure: 'Facture 2026-00002',
    });

    // Divergence artificielle : le montant qu'on repasse à swissqrbill diffère du payload figé
    // (simule un bug de mapping ou une dérive de version de swissqrbill).
    const blocDivergent: BlocPaiementQrFige = { ...blocQr, qrMontantCentimes: 999999 };
    const dataDivergente = construireDonneesSwissQrBill(blocDivergent, '2026-00002');

    expect(() => verifierEquivalencePayload(dataDivergente, payloadFige, 'doc-divergent')).toThrow(
      ErreurMetier,
    );
    try {
      verifierEquivalencePayload(dataDivergente, payloadFige, 'doc-divergent');
      expect.unreachable('devait lever ErreurMetier');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('ERREUR_INTERNE');
    }
  });

  it('REFUS sur divergence artificielle : message reconstruit avec un numéro erroné', () => {
    const { payloadFige, blocQr } = figerCas({
      ibanCreancier: 'CH4431999123000889012',
      creancier: CREANCIER_2026_00002,
      montantCentimes: 7000,
      devise: 'CHF',
      debiteur: null,
      reference: '000000000020261000000000019',
      messageNonStructure: 'Facture 2026-00002',
    });

    // `construireDonneesSwissQrBill` reconstruit `message` depuis `numeroDocument` — un numéro
    // erroné doit être intercepté par la vérification, pas produire un bulletin avec le mauvais
    // message imprimé/encodé.
    const dataAvecMauvaisNumero = construireDonneesSwissQrBill(blocQr, '2026-99999');

    expect(() =>
      verifierEquivalencePayload(dataAvecMauvaisNumero, payloadFige, 'doc-mauvais-numero'),
    ).toThrow(ErreurMetier);
  });
}, 30000);
