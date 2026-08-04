import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';
import type {
  LigneClient,
  LigneClientNote,
  LigneOrdreReparation,
  LigneVehiculeCampagne,
  LigneVehiculeDetention,
  LigneVehiculeExpertise,
  LigneVehiculeKilometrage,
  LigneVehiculeTravailReporte,
} from '../db/schema';
import type { ReponseVehicule } from '@dfa/shared';
import type { Horloge } from '../common/horloge';
import { ErreurMetier } from '../common/erreurs';
import { versReponseTravailReporte } from './service-vehicule-travail-reporte';
import type { DetentionAvecClient } from './vehicule-requetes';

/**
 * Toutes les fonctions de requête (`vehicule-requetes.ts`) sont MOQUÉES ICI — c'est justement ce
 * qui permet de prouver, sans base réelle, que `ServiceVehiculeContexteAtelier` appelle EXACTEMENT
 * ces fonctions (règle anti-divergence, vehicule-requetes.ts:84-91) avec les bons arguments,
 * plutôt qu'une requête parallèle inventée pour l'occasion. L'isolation tenant elle-même (RLS +
 * rescoping `tenant_id`) est déjà couverte, en exécution, par `test/lot1/isolation-vehicules.spec.ts`
 * et par les fonctions partagées de `vehicule-requetes.ts` (hors périmètre d'écriture de ce fichier).
 */
vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  construireReponseVehicule: vi.fn(),
  lireDetentionCouranteAvecClient: vi.fn(),
  lireDernierKilometrage: vi.fn(),
  lireExpertiseReference: vi.fn(),
  listerCampagnesOuvertes: vi.fn(),
  listerTravauxReportesOuverts: vi.fn(),
  compterTravauxReportesOuverts: vi.fn(),
  listerOrOuverts: vi.fn(),
  listerAlertesClient: vi.fn(),
}));

import { ServiceVehiculeContexteAtelier } from './service-vehicule-contexte-atelier';
import * as vehiculeRequetes from './vehicule-requetes';

const TX_FACTICE = {} as TransactionDfa;
const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const VEHICULE_ID = 'vehicule-1';
const MAINTENANT = new Date('2026-07-28T08:00:00.000Z');

function horlogeFixe(): Horloge {
  return { maintenant: () => MAINTENANT } as Horloge;
}

function accesBaseFactice() {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(TX_FACTICE),
    ),
  };
}

function reponseVehiculeFactice(partiel: Partial<ReponseVehicule> = {}): ReponseVehicule {
  return {
    id: VEHICULE_ID,
    vin: 'WVGZZZ1TZJW123456',
    marque: 'VW',
    modele: 'Touran',
    version: '2.0 TDI',
    finition: null,
    codeTypeCh: '1ZM431',
    premiereMiseEnCirculationLe: '2018-03-01',
    designation: 'VW Touran 2.0 TDI',
    plaque: 'VD 123456',
    canton: 'VD',
    carburant: null,
    cylindreeCm3: null,
    puissanceKw: null,
    boite: null,
    transmission: null,
    normeEmission: null,
    couleur: null,
    codeCouleur: null,
    poidsVideKg: null,
    poidsTotalKg: null,
    places: null,
    pneusEte: null,
    pneusHiver: null,
    pressionPneus: null,
    huileType: null,
    huileQuantiteDl: null,
    batterie: null,
    codeRadio: null,
    codeCle: null,
    intervalleEntretienKm: null,
    intervalleEntretienMois: null,
    importe: { estImporte: false, paysOrigine: null, importeLe: null },
    garantieConstructeur: {
      debutLe: '2018-03-01',
      finLe: '2020-03-01',
      plafondKm: 100_000,
      active: false,
    },
    garantieGarage: null,
    proprietaireEconomiqueClientId: null,
    conducteurHabituel: null,
    identificationIncomplete: false,
    statut: 'actif',
    motifArchivage: null,
    fusionneVersVehiculeId: null,
    creeLe: '2018-03-01T00:00:00.000Z',
    modifieLe: '2018-03-01T00:00:00.000Z',
    ...partiel,
  };
}

function detentionAvecClientFactice(partielClient: Partial<LigneClient> = {}): DetentionAvecClient {
  const client: LigneClient = {
    id: 'client-1',
    tenantId: 'tenant-a',
    numero: 'C-004128',
    type: 'particulier',
    civilite: null,
    nom: 'Meier',
    prenom: 'Hans',
    raisonSociale: null,
    ide: null,
    langue: 'de',
    email: null,
    telephone: null,
    telephoneE164: null,
    canalPrefere: null,
    statut: 'actif',
    poObligatoire: true,
    groupeClientId: null,
    fusionneVersClientId: null,
    referenceExterne: null,
    creeLe: new Date('2020-01-01T00:00:00.000Z'),
    modifieLe: new Date('2020-01-01T00:00:00.000Z'),
    ...partielClient,
  } as LigneClient;
  const detention = {
    id: 'detention-1',
    tenantId: 'tenant-a',
    vehiculeId: VEHICULE_ID,
    clientId: client.id,
    du: '2022-05-01',
    au: null,
    motifFin: null,
    creeLe: new Date('2022-05-01T00:00:00.000Z'),
    modifieLe: new Date('2022-05-01T00:00:00.000Z'),
  } as LigneVehiculeDetention;
  return { detention, client };
}

function reinitialiserMocks(): void {
  vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(reponseVehiculeFactice());
  vi.mocked(vehiculeRequetes.lireDetentionCouranteAvecClient).mockResolvedValue(null);
  vi.mocked(vehiculeRequetes.lireDernierKilometrage).mockResolvedValue(null);
  vi.mocked(vehiculeRequetes.lireExpertiseReference).mockResolvedValue(null);
  vi.mocked(vehiculeRequetes.listerCampagnesOuvertes).mockResolvedValue([]);
  vi.mocked(vehiculeRequetes.listerTravauxReportesOuverts).mockResolvedValue([]);
  vi.mocked(vehiculeRequetes.compterTravauxReportesOuverts).mockResolvedValue(0);
  vi.mocked(vehiculeRequetes.listerOrOuverts).mockResolvedValue([]);
  vi.mocked(vehiculeRequetes.listerAlertesClient).mockResolvedValue([]);
}

beforeEach(() => {
  reinitialiserMocks();
});

describe('ServiceVehiculeContexteAtelier.obtenir', () => {
  it("propage l'erreur RESSOURCE_INTROUVABLE de construireReponseVehicule — véhicule inexistant ou d'un autre tenant", async () => {
    vi.mocked(vehiculeRequetes.construireReponseVehicule).mockRejectedValueOnce(
      new ErreurMetier('RESSOURCE_INTROUVABLE', 'Véhicule introuvable.'),
    );
    const acces = accesBaseFactice();
    const service = new ServiceVehiculeContexteAtelier(acces as never, horlogeFixe());

    await expect(service.obtenir(CTX, VEHICULE_ID, 'receptionnaire')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
    // Aucune section suivante n'est interrogée si le véhicule n'existe pas pour ce tenant.
    expect(vehiculeRequetes.lireDetentionCouranteAvecClient).not.toHaveBeenCalled();
  });

  it('appelle chaque section avec EXACTEMENT (tx, ctx, vehiculeId) — même contrat que les endpoints dédiés', async () => {
    const acces = accesBaseFactice();
    const service = new ServiceVehiculeContexteAtelier(acces as never, horlogeFixe());

    await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');

    expect(vehiculeRequetes.construireReponseVehicule).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      VEHICULE_ID,
      MAINTENANT,
    );
    expect(vehiculeRequetes.lireDetentionCouranteAvecClient).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      VEHICULE_ID,
    );
    expect(vehiculeRequetes.lireDernierKilometrage).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      VEHICULE_ID,
    );
    expect(vehiculeRequetes.lireExpertiseReference).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      VEHICULE_ID,
    );
    expect(vehiculeRequetes.listerCampagnesOuvertes).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      VEHICULE_ID,
    );
    expect(vehiculeRequetes.listerTravauxReportesOuverts).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      VEHICULE_ID,
      10,
    );
    expect(vehiculeRequetes.compterTravauxReportesOuverts).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      VEHICULE_ID,
    );
    expect(vehiculeRequetes.listerOrOuverts).toHaveBeenCalledWith(TX_FACTICE, CTX, VEHICULE_ID);
    // Sans détenteur courant, les alertes client ne sont JAMAIS interrogées (pas de clientId).
    expect(vehiculeRequetes.listerAlertesClient).not.toHaveBeenCalled();
  });

  it('vehicule/garantie : reprend TELS QUELS les champs de construireReponseVehicule — identique à GET /vehicules/{id}', async () => {
    const reponse = reponseVehiculeFactice({
      plaque: 'FR 999999',
      canton: 'FR',
      garantieConstructeur: {
        debutLe: '2024-01-01',
        finLe: '2027-01-01',
        plafondKm: 60_000,
        active: true,
      },
    });
    vi.mocked(vehiculeRequetes.construireReponseVehicule).mockResolvedValue(reponse);
    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());

    const contexte = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');

    expect(contexte.vehicule).toEqual({
      id: reponse.id,
      plaque: 'FR 999999',
      canton: 'FR',
      designation: reponse.designation,
      premiereMiseEnCirculationLe: reponse.premiereMiseEnCirculationLe,
      vin: reponse.vin,
      codeTypeCh: reponse.codeTypeCh,
      importe: reponse.importe,
      identificationIncomplete: reponse.identificationIncomplete,
    });
    expect(contexte.garantie).toEqual({
      constructeur: reponse.garantieConstructeur,
      garage: reponse.garantieGarage,
    });
  });

  it('detenteurCourant : projette la détention courante ET déclenche listerAlertesClient sur son clientId', async () => {
    const detention = detentionAvecClientFactice();
    vi.mocked(vehiculeRequetes.lireDetentionCouranteAvecClient).mockResolvedValue(detention);
    const alerte: LigneClientNote = {
      id: 'note-1',
      tenantId: 'tenant-a',
      clientId: detention.client.id,
      nature: 'alerte',
      texte: 'Client conflictuel — présence obligatoire du chef d’atelier.',
      auteurId: null,
      creeLe: new Date('2023-01-01T00:00:00.000Z'),
      modifieLe: new Date('2023-01-01T00:00:00.000Z'),
    } as LigneClientNote;
    vi.mocked(vehiculeRequetes.listerAlertesClient).mockResolvedValue([alerte]);

    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());
    const contexte = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');

    expect(vehiculeRequetes.listerAlertesClient).toHaveBeenCalledWith(
      TX_FACTICE,
      CTX,
      detention.client.id,
    );
    expect(contexte.detenteurCourant).toEqual({
      clientId: detention.client.id,
      numeroClient: 'C-004128',
      nom: 'Meier Hans',
      langueCorrespondance: 'de',
      statut: 'actif',
      depuisLe: '2022-05-01',
      poObligatoire: true,
    });
    expect(contexte.alertesClient).toEqual([
      { id: 'note-1', nature: 'alerte', texte: alerte.texte },
    ]);
  });

  it('expertise : échéance dans le passé → echue=true et joursDepuisEcheance calculé en jours entiers', async () => {
    const expertise = {
      id: 'expertise-1',
      tenantId: 'tenant-a',
      vehiculeId: VEHICULE_ID,
      dateExpertise: '2024-01-15',
      resultat: 'accepte',
      defauts: null,
      delaiContreVisite: null,
      dateContreVisite: null,
      prochaineEcheance: '2026-07-01',
      sourceEcheance: 'calculee',
      creeLe: new Date('2024-01-15T00:00:00.000Z'),
    } as LigneVehiculeExpertise;
    vi.mocked(vehiculeRequetes.lireExpertiseReference).mockResolvedValue(expertise);

    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());
    const contexte = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');

    // MAINTENANT = 2026-07-28, échéance = 2026-07-01 → 27 jours de retard.
    expect(contexte.expertise).toEqual({
      derniereLe: '2024-01-15',
      prochaineLe: '2026-07-01',
      source: 'calculee',
      echue: true,
      joursDepuisEcheance: 27,
    });
  });

  it('expertise : échéance future → echue=false et joursDepuisEcheance=null (jamais un compte négatif)', async () => {
    const expertise = {
      id: 'expertise-2',
      tenantId: 'tenant-a',
      vehiculeId: VEHICULE_ID,
      dateExpertise: '2024-01-15',
      resultat: 'accepte',
      defauts: null,
      delaiContreVisite: null,
      dateContreVisite: null,
      prochaineEcheance: '2026-08-15',
      sourceEcheance: 'convocation',
      creeLe: new Date('2024-01-15T00:00:00.000Z'),
    } as LigneVehiculeExpertise;
    vi.mocked(vehiculeRequetes.lireExpertiseReference).mockResolvedValue(expertise);

    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());
    const contexte = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');

    expect(contexte.expertise).toEqual({
      derniereLe: '2024-01-15',
      prochaineLe: '2026-08-15',
      source: 'convocation',
      echue: false,
      joursDepuisEcheance: null,
    });
  });

  it('expertise : aucune ligne connue → section null (pas un objet à champs null)', async () => {
    vi.mocked(vehiculeRequetes.lireExpertiseReference).mockResolvedValue(null);
    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());
    const contexte = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');
    expect(contexte.expertise).toBeNull();
  });

  it('travauxReportes : total (compte réel) distinct de elements.length (borné) — jamais recalculé depuis elements', async () => {
    const travail: LigneVehiculeTravailReporte = {
      id: 'travail-1',
      tenantId: 'tenant-a',
      vehiculeId: VEHICULE_ID,
      designation: 'Plaquettes de frein AV refusées',
      urgence: 'urgent',
      montantEstimeCentimes: 25_000,
      kmConstat: 88_000,
      dateConstat: '2026-06-01',
      securite: true,
      statut: 'ouvert',
      ordreReparationOrigineId: null,
      ligneOrOrigineId: null,
      ordreReparationRepriseId: null,
      creeLe: new Date('2026-06-01T00:00:00.000Z'),
      modifieLe: new Date('2026-06-01T00:00:00.000Z'),
    } as LigneVehiculeTravailReporte;
    vi.mocked(vehiculeRequetes.listerTravauxReportesOuverts).mockResolvedValue([travail]);
    vi.mocked(vehiculeRequetes.compterTravauxReportesOuverts).mockResolvedValue(14); // > elements.length

    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());

    // Rôle sans droit aux montants : la MÊME fonction que ServiceVehiculeTravailReporte.lister()
    // doit retirer montantEstimeCentimes — preuve du filtrage serveur partagé, pas dupliqué.
    const contexteTechnicien = await service.obtenir(CTX, VEHICULE_ID, 'technicien');
    expect(contexteTechnicien.travauxReportes.total).toBe(14);
    expect(contexteTechnicien.travauxReportes.elements).toEqual([
      versReponseTravailReporte(travail, 'technicien'),
    ]);
    expect(contexteTechnicien.travauxReportes.elements[0]).not.toHaveProperty(
      'montantEstimeCentimes',
    );

    const contexteReception = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');
    expect(contexteReception.travauxReportes.elements).toEqual([
      versReponseTravailReporte(travail, 'receptionnaire'),
    ]);
    expect(contexteReception.travauxReportes.elements[0]).toMatchObject({
      montantEstimeCentimes: 25_000,
    });
  });

  it('campagnesOuvertes/ordresReparationOuverts/depotPneus/avertissements : projections minimales attendues par le contrat', async () => {
    const campagne = {
      id: 'campagne-1',
      code: '23K7',
      description: 'Rappel airbag passager',
      obligatoire: true,
      statut: 'ouverte',
      closeLe: null,
      ordreReparationId: null,
    } as LigneVehiculeCampagne;
    const or = { id: 'or-1', numero: 'OR-2026-0042', statut: 'en_cours' } as LigneOrdreReparation;
    vi.mocked(vehiculeRequetes.listerCampagnesOuvertes).mockResolvedValue([campagne]);
    vi.mocked(vehiculeRequetes.listerOrOuverts).mockResolvedValue([or]);

    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());
    const contexte = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');

    expect(contexte.campagnesOuvertes).toEqual([
      { id: 'campagne-1', code: '23K7', description: 'Rappel airbag passager', obligatoire: true },
    ]);
    expect(contexte.ordresReparationOuverts).toEqual([
      { id: 'or-1', numero: 'OR-2026-0042', statut: 'en_cours' },
    ]);
    expect(contexte.depotPneus).toBeNull();
    expect(contexte.avertissements).toEqual([]);
  });

  it('dernierKilometrage : convertit en km via la même règle que ServiceVehiculeKilometrage (valeurKm si présent, sinon conversion)', async () => {
    const releve: LigneVehiculeKilometrage = {
      id: 'km-1',
      tenantId: 'tenant-a',
      vehiculeId: VEHICULE_ID,
      valeur: 60_000,
      unite: 'mi',
      valeurKm: null,
      releveLe: new Date('2026-07-01T10:00:00.000Z'),
      source: 'declaratif',
      motifRegression: null,
      ordreReparationId: null,
      saisiParId: null,
      creeLe: new Date('2026-07-01T10:00:00.000Z'),
    } as LigneVehiculeKilometrage;
    vi.mocked(vehiculeRequetes.lireDernierKilometrage).mockResolvedValue(releve);

    const service = new ServiceVehiculeContexteAtelier(accesBaseFactice() as never, horlogeFixe());
    const contexte = await service.obtenir(CTX, VEHICULE_ID, 'receptionnaire');

    expect(contexte.dernierKilometrage).toEqual({
      valeurKm: Math.round(60_000 * 1.609344),
      unite: 'mi',
      releveLe: releve.releveLe.toISOString(),
      source: 'declaratif',
    });
  });
});
