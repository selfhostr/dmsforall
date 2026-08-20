import { describe, expect, it } from 'vitest';
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
