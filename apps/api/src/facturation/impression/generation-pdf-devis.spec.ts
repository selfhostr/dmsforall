/**
 * PDF de devis : titre « Devis », date de validité (30 jours), aucun bulletin QR ni numéro de
 * facture, brouillon sans numéro. Génère un VRAI PDF (jamais mocké) et décode le texte dessiné,
 * même technique que `generation-pdf-facture.spec.ts`.
 */

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ReponseDocumentVente } from '@dfa/shared';

import { dateValiditeDevis, genererPdfDevis, genererPdfFacture } from './generation-pdf-facture';
import { ajouterJoursIso } from './formatage-suisse';

const EXPEDITEUR = {
  nom: 'Garage Martin SA',
  rue: 'Route de Riddes',
  numero: '42',
  npa: '1950',
  localite: 'Sion',
};

function extraireBlocsTexte(pdf: Buffer): string[] {
  const contenu = pdf.toString('latin1');
  const blocs: string[] = [];
  for (const m of contenu.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    let texte: string;
    try {
      texte = inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    for (const bt of texte.matchAll(/BT([\s\S]*?)ET/g)) {
      const chaine = [...(bt[1] ?? '').matchAll(/<([0-9a-fA-F]+)>/g)]
        .map(([, hex]) => Buffer.from(hex ?? '', 'hex').toString('latin1'))
        .join('');
      if (chaine.length > 0) blocs.push(chaine);
    }
  }
  return blocs;
}

function devis(surcharges: Partial<ReponseDocumentVente> = {}): ReponseDocumentVente {
  return {
    id: 'devis-1',
    typeDocument: 'devis',
    natureFacture: null,
    origine: 'dfa',
    numero: 'DEV-2026-00007',
    numeroSequence: 7,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: null,
    siteId: 'site-1',
    clientId: 'client-1',
    vehiculeId: 'veh-1',
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Durand Paul',
      clientIde: null,
      clientLangue: 'fr',
      adresseFacturation: {
        rue: 'Rue du Lac',
        numero: '3',
        npa: '1003',
        localite: 'Lausanne',
        pays: 'CH',
      },
      plaque: null,
    },
    dateDocument: '2026-11-07',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: 9250,
    totalTvaCentimes: 750,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: 10000,
    ventilationTva: [
      { regimeTva: 'normal', tauxTvaPourmille: 81, baseCentimes: 9250, tvaCentimes: 750 },
    ],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: 10000,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: null,
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [
      {
        id: 'l-1',
        documentId: 'devis-1',
        numeroOrdre: 1,
        type: 'main_oeuvre_bareme',
        ligneOrId: null,
        documentAcompteId: null,
        designation: 'Vidange moteur',
        referenceTexte: null,
        articleId: null,
        quantiteMillieme: 1000,
        modeCalculTva: 'ttc',
        regimeTva: 'normal',
        tauxTvaPourmille: 81,
        datePrestation: '2026-11-07',
        remisePourmille: null,
        prixUnitaireTtcCentimes: 10000,
        remiseMontantCentimes: null,
        remiseGlobaleRepartieCentimes: 0,
        montants: {
          montantHtCentimes: 9250,
          montantTvaCentimes: 750,
          montantTtcCentimes: 10000,
          montantFacturableCentimes: 10000,
          montantValoriseCentimes: 10000,
        },
        creeLe: '2026-11-07T09:00:00.000Z',
        modifieLe: '2026-11-07T09:00:00.000Z',
      },
    ],
    nombreLignes: 1,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-11-07T09:00:00.000Z',
    emisPar: null,
    creeLe: '2026-11-07T09:00:00.000Z',
    modifieLe: '2026-11-07T09:00:00.000Z',
    modifiePar: null,
    ...surcharges,
  };
}

describe('dateValiditeDevis', () => {
  it('ajoute 30 jours calendaires, à cheval sur un mois et une année', () => {
    expect(dateValiditeDevis('2026-11-07')).toBe('2026-12-07');
    expect(dateValiditeDevis('2026-12-15')).toBe('2027-01-14');
    expect(dateValiditeDevis('2028-02-01')).toBe('2028-03-02'); // 2028 bissextile
  });
  it('ajouterJoursIso refuse une date illisible', () => {
    expect(() => ajouterJoursIso('pas une date', 1)).toThrow(RangeError);
  });
});

describe('genererPdfDevis', () => {
  it('imprime le titre Devis, la validité, les montants et aucune mention de facture ni de QR', async () => {
    const pdf = await genererPdfDevis(devis(), EXPEDITEUR);
    const blocs = extraireBlocsTexte(pdf);

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(blocs).toContain('Devis n° DEV-2026-00007');
    expect(blocs.some((b) => b === "Valable jusqu'au : 07.12.2026")).toBe(true);
    expect(blocs).toContain('Garage Martin SA');
    expect(blocs).toContain('Vidange moteur');
    expect(blocs).toContain('CHF 100.00');
    expect(blocs.some((b) => b.startsWith('Facture'))).toBe(false);
    expect(blocs.some((b) => /Zahlteil|Récépissé|Section paiement/i.test(b))).toBe(false);
  });

  it('un brouillon sans numéro est titré « Devis (brouillon) »', async () => {
    const pdf = await genererPdfDevis(
      devis({ numero: null, numeroSequence: null, statut: 'brouillon' }),
      EXPEDITEUR,
    );
    const blocs = extraireBlocsTexte(pdf);
    expect(blocs).toContain('Devis (brouillon)');
    expect(blocs.some((b) => b.includes('DEV-'))).toBe(false);
  });

  it('un client allemand reçoit « Offerte »', async () => {
    const d = devis();
    const pdf = await genererPdfDevis(
      devis({ figees: { ...d.figees, clientLangue: 'de' } }),
      EXPEDITEUR,
    );
    expect(extraireBlocsTexte(pdf)).toContain('Offerte Nr. DEV-2026-00007');
  });

  it('refuse un document qui n’est pas un devis', async () => {
    await expect(
      genererPdfDevis(devis({ typeDocument: 'facture' }), EXPEDITEUR),
    ).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
  });

  it('refuse d’imprimer sans montants (rôle sans droit aux montants)', async () => {
    await expect(
      genererPdfDevis(devis({ totalHtCentimes: undefined, ventilationTva: undefined }), EXPEDITEUR),
    ).rejects.toMatchObject({ code: 'ERREUR_INTERNE' });
  });

  it('genererPdfFacture refuse toujours un devis', async () => {
    await expect(genererPdfFacture(devis())).rejects.toMatchObject({ code: 'ERREUR_INTERNE' });
  });
});

describe('genererPdfFacture sans bloc QR', () => {
  it('rend la facture sans bulletin, avec la mention de coordonnées non renseignées', async () => {
    const pdf = await genererPdfFacture(
      devis({ typeDocument: 'facture', natureFacture: 'ordinaire', numero: 'FAC-1', qr: null }),
      EXPEDITEUR,
    );
    const blocs = extraireBlocsTexte(pdf);
    expect(blocs).toContain('Facture n° FAC-1');
    expect(blocs).toContain('Garage Martin SA');
    expect(blocs.some((b) => b.startsWith('Coordonnées de paiement'))).toBe(true);
    expect(blocs).toContain('CHF 100.00');
  });
  it('refuse un QR absent sans expéditeur', async () => {
    await expect(
      genererPdfFacture(devis({ typeDocument: 'facture', qr: null })),
    ).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
  });
});
