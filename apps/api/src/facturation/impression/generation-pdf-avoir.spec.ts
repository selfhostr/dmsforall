/**
 * PDF d'avoir : titre « Avoir n° … », référence de la facture corrigée, en-tête du garage avec n° TVA,
 * montants négatifs exacts, aucun bulletin QR. VRAI PDF décodé (jamais mocké).
 */

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ReponseDocumentVente } from '@dfa/shared';

import { genererPdfAvoir } from './generation-pdf-facture';

const EXPEDITEUR = {
  nom: 'Garage Martin SA',
  rue: 'Route de Riddes',
  numero: '42',
  npa: '1950',
  localite: 'Sion',
  numeroTva: 'CHE-123.456.789 TVA',
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

function avoirEmis(surcharges: Partial<ReponseDocumentVente> = {}): ReponseDocumentVente {
  return {
    id: 'avoir-1',
    typeDocument: 'avoir',
    natureFacture: null,
    origine: 'dfa',
    numero: '2026-AV-00001',
    numeroSequence: 7,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: null,
    factureAnnuleeId: 'fac-1',
    siteId: 'site-1',
    clientId: 'client-1',
    vehiculeId: 'veh-1',
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
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
    totalHtCentimes: -9250,
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
        documentId: 'avoir-1',
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
        prixUnitaireTtcCentimes: -10000,
        remiseMontantCentimes: null,
        remiseGlobaleRepartieCentimes: 0,
        montants: {
          montantHtCentimes: -9250,
          montantTvaCentimes: -750,
          montantTtcCentimes: -10000,
          montantFacturableCentimes: -10000,
          montantValoriseCentimes: -10000,
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

describe('genererPdfAvoir', () => {
  it('imprime titre, facture corrigée, n° TVA, montants négatifs et aucun QR', async () => {
    const pdf = await genererPdfAvoir(avoirEmis(), EXPEDITEUR, '2026-00042');
    const blocs = extraireBlocsTexte(pdf);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(blocs).toContain('Avoir n° 2026-AV-00001');
    expect(blocs).toContain('Corrige la facture n° 2026-00042');
    expect(blocs).toContain('Garage Martin SA');
    expect(blocs.some((b) => b.includes('CHE-123.456.789'))).toBe(true);
    expect(blocs).toContain('CHF -100.00');
    expect(blocs.some((b) => /Zahlteil|Récépissé|Section paiement/i.test(b))).toBe(false);
  });

  it('avoir libre : pas de ligne de référence', async () => {
    const blocs = extraireBlocsTexte(await genererPdfAvoir(avoirEmis(), EXPEDITEUR, null));
    expect(blocs.some((b) => b.startsWith('Corrige'))).toBe(false);
  });

  it('client allemand : « Gutschrift Nr. »', async () => {
    const a = avoirEmis();
    const pdf = await genererPdfAvoir(
      avoirEmis({ figees: { ...a.figees, clientLangue: 'de' } }),
      EXPEDITEUR,
      '2026-00042',
    );
    expect(extraireBlocsTexte(pdf)).toContain('Gutschrift Nr. 2026-AV-00001');
  });

  it('refuse un brouillon et un non-avoir', async () => {
    await expect(
      genererPdfAvoir(avoirEmis({ statut: 'brouillon' }), EXPEDITEUR, null),
    ).rejects.toMatchObject({ code: 'ERREUR_INTERNE' });
    await expect(
      genererPdfAvoir(avoirEmis({ typeDocument: 'facture' }), EXPEDITEUR, null),
    ).rejects.toMatchObject({ code: 'ERREUR_INTERNE' });
  });
});
