import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import type { ReponseDevisComplementaire, ReponseOrdreReparation } from '@dfa/shared';

import { genererPdfDevis } from './generation-pdf-devis';
import type { IdentiteGarage } from './donnees-impression-devis';

/**
 * Smoke test UNIQUEMENT : ce fichier vérifie que la mise en page produit un flux PDF valide et ne
 * lève pas, avec et sans lignes, avec et sans réponse. Le CONTENU est testé sans dépendance à
 * `pdfkit` dans `donnees-impression-devis.spec.ts` — même séparation que `generation-pdf-or.spec.ts`.
 */
function ordreReparationFixture(
  overrides: Partial<ReponseOrdreReparation> = {},
): ReponseOrdreReparation {
  return {
    id: 'or-1',
    numero: 'OR-2026-042',
    siteId: 'site-1',
    type: 'reparation',
    statut: 'en_cours',
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
    restitutionPromiseLe: null,
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
    demandes: [],
    lignes: [
      {
        id: 'ligne-1',
        ordreReparationId: 'or-1',
        numeroOrdre: 1,
        type: 'piece',
        origine: 'constatee',
        statut: 'a_valider',
        payeur: 'client',
        payeurClientId: null,
        blocage: 'aucun',
        designation: 'Disques de frein avant',
        referenceTexte: null,
        articleId: null,
        quantiteMillieme: 1000,
        tempsBaremeCentiemes: null,
        tempsBaremeConstructeurCentiemes: null,
        tempsReelCentiemes: null,
        tauxHoraireCentimes: null,
        prixUnitaireCentimes: 10000,
        rabaisPourmille: 0,
        tauxTvaPourmille: 81,
        figeLe: '2026-07-28T07:00:00.000Z',
        montants: { montantHtCentimes: 10000, montantTvaCentimes: 810, montantTtcCentimes: 10810 },
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
    pret: null,
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    totauxParPayeur: [],
    attentes: { accord: true, pieces: false, externe: false },
    etatAffiche: 'attente_accord',
    actionsDisponibles: [],
    version: 3,
    creeLe: '2026-07-28T07:00:00.000Z',
    modifieLe: '2026-07-28T07:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

function devisFixture(
  overrides: Partial<ReponseDevisComplementaire> = {},
): ReponseDevisComplementaire {
  return {
    id: 'devis-1',
    ordreReparationId: 'or-1',
    numeroOrdre: 1,
    lignes: [{ ligneId: 'ligne-1', decision: null }],
    montantTtcCentimes: 10_810,
    nouveauPlafondCentimes: 90_000,
    impactRestitutionLe: null,
    canal: 'telephone',
    destinataireContactId: null,
    envoyeLe: '2026-08-04T10:00:00.000Z',
    emetteur: { utilisateurId: 'u-1', nomAffiche: 'Marie Réception' },
    interlocuteurNom: null,
    repondueLe: null,
    decision: null,
    retranscription: null,
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

const IDENTITE: IdentiteGarage = {
  raisonSociale: 'Garage Martin SA',
  siteNom: 'Sion',
  rue: 'Route de Lausanne 12',
  npa: '1950',
  localite: 'Sion',
};

describe('genererPdfDevis', () => {
  it('produit un flux PDF valide pour un devis en attente, avec ligne', async () => {
    const buffer = await genererPdfDevis(ordreReparationFixture(), devisFixture(), IDENTITE);

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('produit un flux PDF valide pour un devis répondu (accepté)', async () => {
    const buffer = await genererPdfDevis(
      ordreReparationFixture(),
      devisFixture({
        repondueLe: '2026-08-05T09:15:00.000Z',
        decision: 'accepte',
        interlocuteurNom: 'Mme Perret',
      }),
      IDENTITE,
    );

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('produit un flux PDF valide même sans identité de garage résolue (chaînes vides)', async () => {
    const buffer = await genererPdfDevis(ordreReparationFixture(), devisFixture(), {
      raisonSociale: '',
      siteNom: '',
      rue: null,
      npa: null,
      localite: null,
    });

    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('genererPdfDevis — en-tête garage et n° TVA', () => {
  it('imprime raison sociale, adresse et n° TVA au format saisi', async () => {
    const blocs = extraireBlocsTexte(
      await genererPdfDevis(ordreReparationFixture(), devisFixture(), {
        ...IDENTITE,
        numeroTva: 'CHE-114.873.733 TVA',
      }),
    );
    expect(blocs).toContain('Garage Martin SA');
    expect(blocs).toContain('Route de Lausanne 12');
    expect(blocs).toContain('1950 Sion');
    expect(blocs).toContain('CHE-114.873.733 TVA');
  });

  it('sans n° TVA : aucune ligne TVA', async () => {
    const blocs = extraireBlocsTexte(
      await genererPdfDevis(ordreReparationFixture(), devisFixture(), IDENTITE),
    );
    expect(blocs.some((b) => b.includes('CHE-'))).toBe(false);
    expect(blocs).toContain('Garage Martin SA');
  });
});

describe('genererPdfDevis — garage non assujetti à la TVA', () => {
  function ordreSansTva(): ReponseOrdreReparation {
    const base = ordreReparationFixture();
    return {
      ...base,
      lignes: base.lignes.map((l) => ({
        ...l,
        tauxTvaPourmille: 0,
        montants: { montantHtCentimes: 10000, montantTvaCentimes: 0, montantTtcCentimes: 10000 },
      })),
    };
  }

  it('aucune colonne ni récapitulatif TVA ; total 100.00 et mention « Non assujetti à la TVA »', async () => {
    const blocs = extraireBlocsTexte(
      await genererPdfDevis(ordreSansTva(), devisFixture(), {
        ...IDENTITE,
        numeroTva: 'CHE-114.873.733 TVA',
        assujettiTva: false,
      }),
    );
    expect(blocs).toContain('Non assujetti à la TVA');
    expect(blocs.some((b) => b.includes('CHE-'))).toBe(false);
    expect(blocs).not.toContain('TVA');
    expect(blocs.some((b) => b.includes('Récapitulatif'))).toBe(false);
    expect(blocs.some((b) => b.includes('Total TVA') || b.includes('Total HT'))).toBe(false);
    expect(blocs.some((b) => b.includes('Total : CHF 100.00'))).toBe(true);
  });

  it('garage assujetti (non-régression) : colonne et récapitulatif TVA présents, aucune mention', async () => {
    const blocs = extraireBlocsTexte(
      await genererPdfDevis(ordreReparationFixture(), devisFixture(), {
        ...IDENTITE,
        assujettiTva: true,
      }),
    );
    expect(blocs).toContain('TVA');
    expect(blocs.some((b) => b.includes('Récapitulatif TVA'))).toBe(true);
    expect(blocs).not.toContain('Non assujetti à la TVA');
  });
});
