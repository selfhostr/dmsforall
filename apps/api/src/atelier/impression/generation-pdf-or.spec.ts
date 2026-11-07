import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import type { ReponseOrdreReparation } from '@dfa/shared';

import { genererPdfOr } from './generation-pdf-or';

/**
 * Smoke test UNIQUEMENT : ce fichier vérifie que la mise en page produit un flux PDF valide et ne
 * lève pas, pour un OR avec et sans lignes. Le CONTENU (masquage des montants par rôle, phrases
 * d'absence de donnée, traduction des enums) est testé sans dépendance à `pdfkit` dans
 * `donnees-impression-or.spec.ts` — voir la tête de fichier de `generation-pdf-or.ts` pour la
 * raison de cette séparation (le flux binaire `pdfkit` encode le texte en chaînes hexadécimales
 * `TJ`, pas en texte littéral, ce qui rend une assertion directe sur le buffer peu fiable).
 */
function ordreReparationFixture(
  overrides: Partial<ReponseOrdreReparation> = {},
): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'ouvert',
    client: {
      id: 'client-1',
      numeroClient: '2026-0001',
      nomAffiche: 'Jean Dupont',
      type: 'particulier',
      statut: 'actif',
      langueCorrespondance: 'fr',
      poObligatoire: false,
      telephone: '+41 79 123 45 67',
      localite: 'Sion',
      nombreVehicules: 1,
      dernierPassageLe: null,
    },
    vehicule: {
      id: 'vehicule-1',
      plaque: 'VS 123456',
      canton: 'VS',
      designation: 'VW Golf 8',
      vin: 'WVWZZZ1KZAW123456',
      premiereMiseEnCirculationLe: '2020-03-01',
      identificationIncomplete: false,
      emplacementLibre: null,
    },
    figees: {
      clientDesignation: 'Jean Dupont',
      adresseFacturation: null,
      plaque: 'VS 123456',
      detenteurClientId: 'client-1',
    },
    conducteurPresentNom: null,
    kilometrageEntree: 84_500,
    kilometrageSortie: null,
    restitutionPromiseLe: '2026-08-03T15:30:00.000Z',
    restitutionInitialeLe: null,
    localisation: 'atelier',
    sousTraitantNom: null,
    ordreReparationParentId: null,
    motifLien: null,
    rendezVousId: null,
    numeroCommandeInterne: null,
    receptionnaireId: 'user-1',
    retentionInvoqueeLe: null,
    litigeOuvertLe: null,
    ouvertLe: '2026-07-28T07:00:00.000Z',
    termineLe: null,
    factureLe: null,
    restitueLe: null,
    clotureLe: null,
    annuleLe: null,
    motifAnnulation: null,
    demandes: [
      {
        id: 'd-1',
        ordre: 1,
        verbatim: 'Bruit au freinage avant droit',
        saisiLe: '2026-07-28T07:00:00.000Z',
        saisiPar: null,
      },
    ],
    lignes: [
      {
        id: 'ligne-1',
        ordreReparationId: 'or-1',
        numeroOrdre: 1,
        type: 'piece',
        origine: 'constatee',
        statut: 'validee',
        payeur: 'client',
        payeurClientId: null,
        blocage: 'aucun',
        designation: 'Plaquettes de frein avant',
        referenceTexte: null,
        articleId: null,
        quantiteMillieme: 2000,
        tempsBaremeCentiemes: null,
        tempsBaremeConstructeurCentiemes: null,
        tempsReelCentiemes: null,
        tauxHoraireCentimes: null,
        prixUnitaireCentimes: 4500,
        rabaisPourmille: 0,
        tauxTvaPourmille: 81,
        figeLe: '2026-07-28T07:00:00.000Z',
        montants: { montantHtCentimes: 8329, montantTvaCentimes: 671, montantTtcCentimes: 9000 },
        technicienId: null,
        codeOperation: null,
        codeDefaut: null,
        numeroSinistre: null,
        numeroAccord: null,
        urgence: null,
        securite: false,
        fournieParClient: false,
        aRestituer: false,
        restituee: false,
        motifAnnulation: null,
        factureId: null,
        creeLe: '2026-07-28T07:00:00.000Z',
        modifieLe: '2026-07-28T07:00:00.000Z',
      },
    ],
    nombreLignes: 1,
    lignesTronquees: false,
    devisComplementaires: [],
    controleQualite: null,
    signatures: [],
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    totauxParPayeur: [],
    attentes: { accord: false, pieces: false, externe: false },
    etatAffiche: 'ouvert',
    actionsDisponibles: [],
    version: 3,
    creeLe: '2026-07-28T07:00:00.000Z',
    modifieLe: '2026-07-28T07:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

/** Texte réellement dessiné (blocs BT..ET, chaînes hexadécimales), flux compressés ou non. */
function extraireBlocsTexte(pdf: Buffer): string[] {
  const blocs: string[] = [];
  for (const m of pdf.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
    const brut = Buffer.from(m[1] ?? '', 'latin1');
    let texte: string;
    try {
      texte = inflateSync(brut).toString('latin1');
    } catch {
      texte = brut.toString('latin1');
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

describe('genererPdfOr', () => {
  it('produit un flux PDF valide pour un OR avec lignes', async () => {
    const buffer = await genererPdfOr(ordreReparationFixture(), 'Garage Martin — Sion');

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('produit un flux PDF valide pour un OR sans lignes ni demandes (pas d’exception)', async () => {
    const buffer = await genererPdfOr(
      ordreReparationFixture({ lignes: [], nombreLignes: 0, demandes: [] }),
      'Garage Martin',
    );

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('produit un flux PDF valide même sans site résolu (chaîne vide)', async () => {
    const buffer = await genererPdfOr(ordreReparationFixture(), '');

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('genererPdfOr — en-tête garage', () => {
  const emetteur = {
    nom: 'Garage Martin SA',
    rue: 'Route de Lausanne 12',
    npa: '1950',
    localite: 'Sion',
    numeroTva: 'CHE-114.873.733 TVA',
  };

  it('imprime raison sociale, adresse et n° TVA', async () => {
    const blocs = extraireBlocsTexte(
      await genererPdfOr(ordreReparationFixture(), 'Sion', emetteur),
    );
    expect(blocs).toContain('Garage Martin SA');
    expect(blocs).toContain('Route de Lausanne 12');
    expect(blocs).toContain('1950 Sion');
    expect(blocs).toContain('CHE-114.873.733 TVA');
  });

  it('sans n° TVA renseigné : aucune ligne TVA', async () => {
    const blocs = extraireBlocsTexte(
      await genererPdfOr(ordreReparationFixture(), 'Sion', { ...emetteur, numeroTva: null }),
    );
    expect(blocs.some((b) => b.includes('CHE-'))).toBe(false);
    expect(blocs).toContain('Garage Martin SA');
  });
});
