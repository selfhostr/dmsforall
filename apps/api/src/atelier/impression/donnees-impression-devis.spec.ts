import { describe, expect, it } from 'vitest';
import type {
  ReponseDevisComplementaire,
  ReponseLigneOr,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { construireDonneesImpressionDevis, type IdentiteGarage } from './donnees-impression-devis';

function ligneFixture(overrides: Partial<ReponseLigneOr> = {}): ReponseLigneOr {
  return {
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
    ...overrides,
  };
}

const LIGNE_1 = ligneFixture(); // 8.1% — 10'000 HT / 810 TVA / 10'810 TTC
const LIGNE_2 = ligneFixture({
  id: 'ligne-2',
  numeroOrdre: 2,
  designation: 'Plaquettes de frein avant',
  prixUnitaireCentimes: 5000,
  tauxTvaPourmille: 26,
  montants: { montantHtCentimes: 5000, montantTvaCentimes: 130, montantTtcCentimes: 5130 },
}); // 2.6% — 5'000 HT / 130 TVA / 5'130 TTC
// PAS référencée par le devis fixture ci-dessous — sert à prouver que le filtre est réel.
const LIGNE_3_HORS_DEVIS = ligneFixture({
  id: 'ligne-3',
  numeroOrdre: 3,
  designation: 'Vidange moteur (hors devis)',
  prixUnitaireCentimes: 2000,
  montants: { montantHtCentimes: 2000, montantTvaCentimes: 162, montantTtcCentimes: 2162 },
});

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
    lignes: [LIGNE_1, LIGNE_2, LIGNE_3_HORS_DEVIS],
    nombreLignes: 3,
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
    numeroOrdre: 2,
    lignes: [
      { ligneId: 'ligne-1', decision: null },
      { ligneId: 'ligne-2', decision: null },
    ],
    montantTtcCentimes: 15_940,
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

describe('construireDonneesImpressionDevis', () => {
  it('calcule la TVA PAR LIGNE puis l’agrège PAR TAUX — valeurs exactes, jamais de flottant', () => {
    const d = construireDonneesImpressionDevis(ordreReparationFixture(), devisFixture(), IDENTITE);

    expect(d.ventilationTva).toEqual([
      { taux: '2.6%', baseHt: 'CHF 50.00', montantTva: 'CHF 1.30' },
      { taux: '8.1%', baseHt: 'CHF 100.00', montantTva: 'CHF 8.10' },
    ]);
    expect(d.totalHt).toBe('CHF 150.00');
    expect(d.totalTva).toBe('CHF 9.40');
    expect(d.totalTtc).toBe('CHF 159.40');
  });

  it("n'imprime QUE les lignes réellement référencées par CE devis, jamais toutes les lignes de l'OR", () => {
    const d = construireDonneesImpressionDevis(ordreReparationFixture(), devisFixture(), IDENTITE);

    expect(d.lignes).toHaveLength(2);
    expect(d.lignes.map((l) => l.designation).join(' | ')).not.toContain('hors devis');
  });

  it("compose le titre depuis le rang du devis ET le numéro de l'OR", () => {
    const d = construireDonneesImpressionDevis(ordreReparationFixture(), devisFixture(), IDENTITE);

    expect(d.titre).toBe('Devis complémentaire n° 2 — OR OR-2026-042');
  });

  it('devis en attente -> statut explicite, pas de décision ni de date de réponse affichées', () => {
    const d = construireDonneesImpressionDevis(ordreReparationFixture(), devisFixture(), IDENTITE);

    expect(d.statutDevis).toBe('En attente de réponse du client');
    expect(d.dateReponse).toBeNull();
  });

  it('devis répondu (accepté) -> statut composé, date de réponse formatée', () => {
    const d = construireDonneesImpressionDevis(
      ordreReparationFixture(),
      devisFixture({
        repondueLe: '2026-08-05T09:15:00.000Z',
        decision: 'accepte',
        interlocuteurNom: 'Mme Perret',
      }),
      IDENTITE,
    );

    expect(d.statutDevis).toBe('Répondu — Accepté');
    expect(d.dateReponse).toBe('05.08.2026 09:15');
    expect(d.interlocuteurNom).toBe('Mme Perret');
  });

  it('décision PARTIELLE ligne par ligne -> chaque désignation porte SA propre décision', () => {
    const d = construireDonneesImpressionDevis(
      ordreReparationFixture(),
      devisFixture({
        repondueLe: '2026-08-05T09:15:00.000Z',
        decision: 'partiel',
        interlocuteurNom: 'Mme Perret',
        lignes: [
          { ligneId: 'ligne-1', decision: 'accepte' },
          { ligneId: 'ligne-2', decision: 'refuse' },
        ],
      }),
      IDENTITE,
    );

    const ligne1 = d.lignes.find((l) => l.designation.includes('Disques'));
    const ligne2 = d.lignes.find((l) => l.designation.includes('Plaquettes'));
    expect(ligne1?.designation).toContain('[Accepté]');
    expect(ligne2?.designation).toContain('[Refusé]');
  });

  it('aucune décision de ligne enregistrée -> pas de suffixe, jamais un crochet vide', () => {
    const d = construireDonneesImpressionDevis(ordreReparationFixture(), devisFixture(), IDENTITE);

    for (const ligne of d.lignes) {
      expect(ligne.designation).not.toContain('[');
    }
  });

  it("plaque/VIN absents -> phrase explicite par champ, jamais le même rendu qu'une valeur", () => {
    const d = construireDonneesImpressionDevis(
      ordreReparationFixture({
        vehicule: {
          id: 'vehicule-1',
          plaque: null,
          canton: null,
          designation: 'VW Golf 8',
          vin: null,
          premiereMiseEnCirculationLe: null,
          identificationIncomplete: true,
          emplacementLibre: null,
        },
      }),
      devisFixture(),
      IDENTITE,
    );

    expect(d.immatriculation).toBe('Plaque non renseignée');
    expect(d.vin).toBe('VIN non renseigné');
  });

  it('respecte la langue du CLIENT (DE) pour tout le vocabulaire traduit', () => {
    const d = construireDonneesImpressionDevis(
      ordreReparationFixture({
        client: { ...ordreReparationFixture().client, langueCorrespondance: 'de' },
      }),
      devisFixture(),
      IDENTITE,
    );

    expect(d.statutDevis).toBe('Wartet auf Antwort des Kunden');
    expect(d.libelles.colonneTva).toBe('MWST');
  });

  it('impact sur la restitution et nouveau plafond absents -> null, jamais "CHF 0.00"', () => {
    const d = construireDonneesImpressionDevis(
      ordreReparationFixture(),
      devisFixture({ nouveauPlafondCentimes: undefined, impactRestitutionLe: null }),
      IDENTITE,
    );

    expect(d.nouveauPlafond).toBeNull();
    expect(d.impactRestitution).toBeNull();
  });

  it('nouveau plafond et impact sur restitution présents -> formatés', () => {
    const d = construireDonneesImpressionDevis(
      ordreReparationFixture(),
      devisFixture({ impactRestitutionLe: '2026-08-06T16:00:00.000Z' }),
      IDENTITE,
    );

    expect(d.nouveauPlafond).toBe('CHF 900.00');
    expect(d.impactRestitution).toBe('06.08.2026 16:00');
  });

  it('ligne sans montants (rôle non filtré en amont) -> lève ERREUR_INTERNE plutôt que d’imprimer un prix inventé', () => {
    const ordreReparation = ordreReparationFixture({
      lignes: [{ ...LIGNE_1, montants: undefined }, LIGNE_2, LIGNE_3_HORS_DEVIS],
    });

    expect(() =>
      construireDonneesImpressionDevis(ordreReparation, devisFixture(), IDENTITE),
    ).toThrow(/sans montants/);
  });

  it('identité du garage transmise telle quelle (raison sociale, site, adresse)', () => {
    const d = construireDonneesImpressionDevis(ordreReparationFixture(), devisFixture(), IDENTITE);

    expect(d.garageRaisonSociale).toBe('Garage Martin SA');
    expect(d.garageSiteNom).toBe('Sion');
    expect(d.garageAdresseLigne1).toBe('Route de Lausanne 12');
    expect(d.garageAdresseLigne2).toBe('1950 Sion');
  });
});
