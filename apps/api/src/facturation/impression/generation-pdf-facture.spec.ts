/**
 * Non-régression #126 bis (trouvée par la contre-vérification indépendante après le correctif
 * initial #126 — devise absente du corps du PDF) : élargir `prixUnitaire`/`total` pour absorber le
 * préfixe devise avait RÉTRÉCI la colonne `tva` à 25pt, assez pour `"TVA"`/`"IVA"` (3 caractères)
 * mais pas pour l'allemand `"MWST"` (4 caractères, `libelles-impression.ts` DE) — qui se scindait
 * en `"MWS"` / `"T"` sur deux lignes dans le PDF réellement produit.
 *
 * Génère un VRAI PDF (le même `genererPdfFacture` que la route `GET /documents-vente/{id}/pdf`,
 * jamais mocké ici) pour une facture en ALLEMAND avec un montant à 8 chiffres (pire cas des deux
 * dimensions à la fois : le plus long en-tête de colonne ET le plus long montant plausible), puis
 * DÉCODE le flux PDF produit (FlateDecode) pour extraire le texte réellement dessiné — pas une
 * supposition sur la mise en page, la preuve porte sur les octets produits.
 */

import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ReponseDocumentVente } from '@dfa/shared';

import { calculerLigneDocument, calculerTotauxDocument } from '../documents/calcul-document';
import { construireReferenceQrr, encoderChargeUtileQr } from '../qr';

import { genererPdfFacture } from './generation-pdf-facture';

const CREANCIER = {
  nom: 'Garage Martin SA',
  rue: 'Route de Riddes',
  numero: '42',
  npa: '1950',
  localite: 'Sion',
  pays: 'CH',
};

/** Décode le contenu texte réellement dessiné par `pdfkit` : chaque bloc `BT...ET` du flux
 *  `FlateDecode`, chaîne hexadécimale (`<...>`) décodée en ASCII/Latin-1 — même mécanisme que la
 *  preuve en exécution réelle du rapport de livraison (extraction manuelle des PDF générés par
 *  l'API `:3000`), reproduit ici en test automatisé pour ne jamais régresser en silence. */
function extraireBlocsTexte(pdf: Buffer): string[] {
  const contenu = pdf.toString('latin1');
  const blocsStream = [...contenu.matchAll(/stream\r?\n([\s\S]*?)endstream/g)];
  const blocsTexte: string[] = [];

  for (const m of blocsStream) {
    const brut = Buffer.from(m[1] ?? '', 'latin1');
    let inflate: Buffer;
    try {
      inflate = inflateSync(brut);
    } catch {
      continue; // Flux non compressé (police embarquée, image…) : hors de notre intérêt ici.
    }
    const texte = inflate.toString('latin1');
    for (const bt of texte.matchAll(/BT([\s\S]*?)ET/g)) {
      const hexTokens = [...(bt[1] ?? '').matchAll(/<([0-9a-fA-F]+)>/g)];
      const chaine = hexTokens
        .map(([, hex]) => Buffer.from(hex ?? '', 'hex').toString('latin1'))
        .join('');
      if (chaine.length > 0) blocsTexte.push(chaine);
    }
  }
  return blocsTexte;
}

/** Facture en allemand, un seul montant à 8 chiffres (`CHF 123'456.78`) — pire cas plausible pour
 *  les largeurs de colonnes : en-tête `"MWST"` (le plus long des trois langues) ET montant le plus
 *  long une fois préfixé de la devise. */
function factureAllemandeGrandMontant(): ReponseDocumentVente {
  const PRIX_UNITAIRE_TTC = 12_345_678; // CHF 123'456.78
  const montants = calculerLigneDocument({
    prixUnitaireTtcCentimes: PRIX_UNITAIRE_TTC,
    quantiteMillieme: 1000,
    remisePourmille: null,
    remiseMontantCentimes: null,
    remiseGlobaleRepartieCentimes: 0,
    tauxTvaPourmille: 81,
  });
  const totaux = calculerTotauxDocument([
    {
      htCentimes: montants.htCentimes,
      tvaCentimes: montants.tvaCentimes,
      ttcCentimes: montants.ttcCentimes,
    },
  ]);

  const numero = 'FAC-2026-00099';
  const chargeUtile = encoderChargeUtileQr({
    ibanCreancier: 'CH4431999123000889012',
    creancier: CREANCIER,
    montantCentimes: totaux.totalTtcCentimes,
    devise: 'CHF',
    debiteur: null,
    reference: construireReferenceQrr('00000000002026099000000000'),
    // `donnees-swissqrbill.ts::construireDonneesSwissQrBill` reconstruit TOUJOURS
    // `"Facture <numero>"` à l'impression, quelle que soit la langue (même règle qu'à l'émission,
    // `qr-emission.ts::construireBlocQrPourEmission`) — le payload figé ici doit matcher EXACTEMENT
    // cette reconstruction, sous peine de refus DI-3/MD-77. Non lié à ce test (largeurs de
    // colonnes) : hors périmètre, non modifié.
    messageNonStructure: `Facture ${numero}`,
  });

  return {
    id: 'doc-mwst-1',
    typeDocument: 'facture',
    natureFacture: 'ordinaire',
    origine: 'dfa',
    numero,
    numeroSequence: 99,
    numeroOrigine: null,
    exercice: 2026,
    statut: 'emis',
    statutReglement: 'non_regle',
    siteId: 'site-1',
    clientId: 'client-de-1',
    vehiculeId: null,
    ordreReparationId: null,
    dossierVenteId: null,
    documentSourceId: null,
    factureAnnuleeId: null,
    annuleParAvoirId: null,
    remplaceId: null,
    figees: {
      clientDesignation: 'Meier Urs',
      clientIde: null,
      clientLangue: 'de',
      adresseFacturation: {
        rue: 'Bahnhofstrasse',
        numero: '12',
        npa: '1950',
        localite: 'Sion',
        pays: 'CH',
      },
      plaque: null,
    },
    dateDocument: '2026-08-13',
    devise: 'CHF',
    tvaNonVentilee: false,
    tauxTvaPourmilleDocument: null,
    mentionTvaInterdite: false,
    totalHtCentimes: totaux.totalHtCentimes,
    totalTvaCentimes: totaux.totalTvaCentimes,
    ecartRepriseCentimes: 0,
    totalTtcCentimes: totaux.totalTtcCentimes,
    ventilationTva: [
      {
        regimeTva: 'normal',
        tauxTvaPourmille: 81,
        baseCentimes: montants.htCentimes,
        tvaCentimes: montants.tvaCentimes,
      },
    ],
    remiseGlobaleSaisieCentimes: null,
    remiseGlobalePourmille: null,
    montantRegleCentimes: 0,
    soldeCentimes: totaux.totalTtcCentimes,
    relanceNiveau: 0,
    relanceLe: null,
    motifAvoir: null,
    motifAvoirAutre: null,
    porteeAvoir: null,
    qr: {
      qrPayload: chargeUtile.payload,
      qrPayloadSha256: 'non pertinent pour ce test',
      typeReferenceQr: chargeUtile.typeReference.toLowerCase() as 'qrr',
      qrReference: chargeUtile.reference,
      qrMontantCentimes: totaux.totalTtcCentimes,
      qrDevise: 'CHF',
      qrLangue: 'de',
      creancier: {
        iban: 'CH4431999123000889012',
        estQrIban: true,
        nom: CREANCIER.nom,
        adresse: {
          rue: CREANCIER.rue,
          numero: CREANCIER.numero,
          npa: CREANCIER.npa,
          localite: CREANCIER.localite,
          pays: CREANCIER.pays,
        },
      },
      debiteur: null,
    },
    pdfCle: null,
    pdfSha256: null,
    exporteLe: null,
    exportId: null,
    contentieux: false,
    lignes: [
      {
        id: 'ligne-1',
        documentId: 'doc-mwst-1',
        numeroOrdre: 1,
        type: 'forfait',
        ligneOrId: null,
        documentAcompteId: null,
        designation: 'Grossauftrag Karosserie und Lackierung komplett',
        referenceTexte: null,
        articleId: null,
        quantiteMillieme: 1000,
        modeCalculTva: 'ttc',
        regimeTva: 'normal',
        tauxTvaPourmille: 81,
        datePrestation: '2026-08-13',
        remisePourmille: null,
        prixUnitaireTtcCentimes: PRIX_UNITAIRE_TTC,
        remiseMontantCentimes: null,
        remiseGlobaleRepartieCentimes: 0,
        montants: {
          montantHtCentimes: montants.htCentimes,
          montantTvaCentimes: montants.tvaCentimes,
          montantTtcCentimes: montants.ttcCentimes,
          montantFacturableCentimes: montants.ttcCentimes,
          montantValoriseCentimes: montants.ttcCentimes,
        },
        creeLe: '2026-08-13T09:00:00.000Z',
        modifieLe: '2026-08-13T09:00:00.000Z',
      },
    ],
    nombreLignes: 1,
    lignesTronquees: false,
    version: 1,
    emisLe: '2026-08-13T09:00:00.000Z',
    emisPar: null,
    creeLe: '2026-08-13T09:00:00.000Z',
    modifieLe: '2026-08-13T09:00:00.000Z',
    modifiePar: null,
  };
}

describe('genererPdfFacture — largeurs de colonnes (régression #126 bis)', () => {
  it('facture en allemand, montant à 8 chiffres : "MWST" tient sur une seule ligne, aucun montant ne se scinde', async () => {
    const document = factureAllemandeGrandMontant();
    const pdf = await genererPdfFacture(document);
    const blocs = extraireBlocsTexte(pdf);

    // L'en-tête de colonne complet "MWST" doit apparaître comme UN SEUL bloc de texte — avant le
    // correctif de largeur, il se scindait en deux blocs adjacents "MWS" et "T".
    expect(blocs).toContain('MWST');
    expect(blocs).not.toContain('MWS');
    expect(blocs).not.toContain('T');

    // Montants avec devise, pire cas 8 chiffres : chacun doit apparaître INTACT, jamais coupé.
    expect(blocs).toContain("CHF 123'456.78"); // prix unitaire ET total de la ligne (même valeur)
    expect(blocs.filter((b) => b === "CHF 123'456.78")).toHaveLength(2);

    // Récapitulatif TVA : libellés allemands composés ("Basis Netto"/"MWST-Betrag") + montant,
    // sur la MÊME chaîne (même construction que dessinerRecapitulatifTva) — preuve qu'ils ne se
    // scindent pas non plus avec la colonne élargie.
    const baseHt = blocs.find((b) => b.startsWith('Basis Netto'));
    const montantTva = blocs.find((b) => b.startsWith('MWST-Betrag'));
    expect(baseHt).toBeDefined();
    expect(montantTva).toBeDefined();
    expect(baseHt).toContain('CHF');
    expect(montantTva).toContain('CHF');

    expect(blocs.some((b) => b.startsWith('Total Netto'))).toBe(true);
    expect(blocs.some((b) => b.startsWith('Total MWST'))).toBe(true);
    expect(blocs.some((b) => b.startsWith('Total Brutto'))).toBe(true);
  });
});
