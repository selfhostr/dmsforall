import { describe, expect, it } from 'vitest';
import type { ReponseOrdreReparation } from '@dfa/shared';

import { construireDonneesImpressionOr } from './donnees-impression-or';

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
    pret: null,
    cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
    totauxParPayeur: [],
    attentes: { accord: false, pieces: false, externe: false },
    etatAffiche: 'en_cours',
    actionsDisponibles: [],
    version: 3,
    creeLe: '2026-07-28T07:00:00.000Z',
    modifieLe: '2026-07-28T07:00:00.000Z',
    modifiePar: null,
    ...overrides,
  };
}

describe('construireDonneesImpressionOr', () => {
  it("porte le numéro d'OR, le site, le véhicule, le client et la ligne — vocabulaire garagiste, pas les codes bruts", () => {
    const d = construireDonneesImpressionOr(ordreReparationFixture(), 'Garage Martin — Sion');

    expect(d.numero).toBe('OR-2026-042');
    expect(d.site).toBe('Garage Martin — Sion');
    expect(d.type).toBe('Réparation'); // traduit, pas "reparation"
    expect(d.statut).toBe('En cours'); // traduit, pas "en_cours"
    expect(d.vehiculeDesignation).toBe('VW Golf 8');
    expect(d.immatriculation).toBe('VS 123456');
    expect(d.vin).toBe('WVWZZZ1KZAW123456');
    expect(d.kilometrageEntree).toBe("84'500 km");
    expect(d.clientNom).toBe('Jean Dupont');
    expect(d.telephone).toBe('+41 79 123 45 67');
    expect(d.demandes).toEqual(['Bruit au freinage avant droit']);
    expect(d.restitutionPromise).toBe('03.08.2026 15:30');
  });

  it('imprime les colonnes de prix quand le rôle voit les montants (totauxParPayeur présent, même vide)', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({ totauxParPayeur: [] }),
      'Garage',
    );

    expect(d.voitMontants).toBe(true);
    expect(d.lignes).toHaveLength(1);
    expect(d.lignes[0]?.prixUnitaire).toBe('45.00');
    expect(d.lignes[0]?.montant).toBe('90.00');
  });

  it('OMET les colonnes de prix (null, jamais "0.00") quand le rôle ne voit pas les montants (technicien)', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({
        totauxParPayeur: undefined,
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
            rabaisPourmille: 0,
            tauxTvaPourmille: 81,
            figeLe: '2026-07-28T07:00:00.000Z',
            // Ni `montants` ni `prixUnitaireCentimes` — exactement ce que `mapperLigneOr` rend
            // pour un rôle sans droit aux montants.
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
      }),
      'Garage',
    );

    expect(d.voitMontants).toBe(false);
    expect(d.lignes[0]?.prixUnitaire).toBeNull();
    expect(d.lignes[0]?.montant).toBeNull();
    // La désignation et la quantité, elles, restent visibles — seul le prix est un geste de
    // gouvernance distinct (RM du droit d'imprimer partagé avec le droit de lire l'OR).
    expect(d.lignes[0]?.designation).toContain('Plaquettes de frein avant');
    expect(d.lignes[0]?.quantite).toBe('2');
  });

  it('restitution non définie -> phrase explicite, jamais un champ vide ambigu', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({ restitutionPromiseLe: null }),
      'Garage',
    );

    expect(d.restitutionPromise).toBe('Non définie');
  });

  it('plaque/VIN/téléphone absents -> phrase explicite par champ, jamais le même rendu qu’une valeur', () => {
    const d = construireDonneesImpressionOr(
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
        client: { ...ordreReparationFixture().client, telephone: null },
      }),
      'Garage',
    );

    expect(d.immatriculation).toBe('Plaque non renseignée');
    expect(d.vin).toBe('VIN non renseigné');
    expect(d.telephone).toBe('Non renseigné');
  });

  it('site introuvable (chaîne vide transmise par le service) -> `site` vide, jamais un uuid affiché', () => {
    const d = construireDonneesImpressionOr(ordreReparationFixture(), '');

    expect(d.site).toBe('');
  });

  it('kilométrage de sortie absent -> null (ligne omise à l’impression), jamais "0 km"', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({ kilometrageSortie: null }),
      'Garage',
    );

    expect(d.kilometrageSortie).toBeNull();
  });

  it('demandes vides -> tableau vide, la feuille affiche alors le libellé « aucune demande »', () => {
    const d = construireDonneesImpressionOr(ordreReparationFixture({ demandes: [] }), 'Garage');

    expect(d.demandes).toEqual([]);
  });

  it('respecte la langue du client (DE) pour tout le vocabulaire traduit', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({
        client: { ...ordreReparationFixture().client, langueCorrespondance: 'de' },
      }),
      'Garage',
    );

    expect(d.type).toBe('Reparatur');
    expect(d.statut).toBe('In Arbeit');
    expect(d.libelles.client).toBe('Kunde');
  });
});
