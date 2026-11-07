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
  it("porte le numéro d'OR, le site, le véhicule et la ligne — vocabulaire garagiste, pas les codes bruts", () => {
    const d = construireDonneesImpressionOr(ordreReparationFixture(), 'Garage Martin — Sion');

    expect(d.numero).toBe('OR-2026-042');
    expect(d.site).toBe('Garage Martin — Sion');
    expect(d.type).toBe('Réparation'); // traduit, pas "reparation"
    expect(d.statut).toBe('En cours'); // traduit, pas "en_cours"
    expect(d.vehiculeDesignation).toBe('VW Golf 8');
    expect(d.immatriculation).toBe('VS 123456');
    expect(d.vin).toBe('WVWZZZ1KZAW123456');
    expect(d.kilometrageEntree).toBe("84'500 km");
    expect(d.demandes).toEqual(['Bruit au freinage avant droit']);
    expect(d.restitutionPromise).toBe('03.08.2026 15:30');
  });

  // Issue #114 : cette feuille est accrochée au rétroviseur d'un véhicule garé DEHORS — elle ne
  // porte plus JAMAIS le nom du client ni son téléphone, quel que soit le rôle qui imprime.
  it('NE porte NI le nom du client NI son téléphone — jamais, quel que soit le rôle', () => {
    const d = construireDonneesImpressionOr(ordreReparationFixture(), 'Garage');

    expect(d).not.toHaveProperty('clientNom');
    expect(d).not.toHaveProperty('telephone');
  });

  // Distinct du masquage des montants par rôle (`ROLES_SANS_MONTANT`), qui reste actif AILLEURS
  // sur `ReponseOrdreReparation` (`document.totauxParPayeur`) — ce module ne le lit simplement
  // plus jamais : aucun prix, aucun total, pour personne, quelle que soit la présence de
  // `totauxParPayeur` sur le document source.
  it("N'IMPRIME AUCUN prix ni montant, présence ou non de totauxParPayeur sur le document source", () => {
    const avecMontants = construireDonneesImpressionOr(
      ordreReparationFixture({ totauxParPayeur: [] }),
      'Garage',
    );
    const sansMontants = construireDonneesImpressionOr(
      ordreReparationFixture({ totauxParPayeur: undefined }),
      'Garage',
    );

    for (const d of [avecMontants, sansMontants]) {
      expect(d).not.toHaveProperty('voitMontants');
      expect(d.lignes[0]).not.toHaveProperty('prixUnitaire');
      expect(d.lignes[0]).not.toHaveProperty('montant');
      expect(d.lignes[0]?.designation).toContain('Plaquettes de frein avant');
      expect(d.lignes[0]?.quantite).toBe('2');
    }
  });

  it('nomme le·s technicien·ne·s ayant pointé sur l’OR, joints par une virgule', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({
        cumulsPointage: {
          totalCentiemes: 480,
          parTechnicien: [
            { technicienId: 't-1', nomAffiche: 'Marco Rossi', centiemes: 300 },
            { technicienId: 't-2', nomAffiche: 'Sophie Bruchez', centiemes: 180 },
          ],
          pointagesOuverts: 0,
        },
      }),
      'Garage',
    );

    expect(d.technicien).toBe('Marco Rossi, Sophie Bruchez');
  });

  it('aucun pointage rattaché -> technicien `null` (ligne omise à l’impression), jamais une chaîne vide', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({
        cumulsPointage: { totalCentiemes: 0, parTechnicien: [], pointagesOuverts: 0 },
      }),
      'Garage',
    );

    expect(d.technicien).toBeNull();
  });

  it('restitution non définie -> phrase explicite, jamais un champ vide ambigu', () => {
    const d = construireDonneesImpressionOr(
      ordreReparationFixture({ restitutionPromiseLe: null }),
      'Garage',
    );

    expect(d.restitutionPromise).toBe('Non définie');
  });

  it('plaque/VIN absents -> phrase explicite par champ, jamais le même rendu qu’une valeur', () => {
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
      }),
      'Garage',
    );

    expect(d.immatriculation).toBe('Plaque non renseignée');
    expect(d.vin).toBe('VIN non renseigné');
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
    expect(d.libelles.technicien).toBe('Techniker');
  });
});
