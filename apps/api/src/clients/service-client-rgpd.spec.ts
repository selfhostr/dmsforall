import { describe, expect, it, vi } from 'vitest';
import type { OrdreReparationResume, ReponseClient, VehiculeResume } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';

import { ServiceClientRgpd } from './service-client-rgpd';
import type { ServiceClient } from './service-client';
import type { ServiceClientOrdresReparation } from './service-client-ordres-reparation';
import type { ServiceClientVehicules } from './service-client-vehicules';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

/**
 * Fausse transaction locale à ce fichier — même patron que `service-client.spec.ts::txFactice`,
 * étendu sur deux points nécessaires ici, absents des autres specs du module :
 *
 *  - `execute()` pilotable en ÉCHEC (pas seulement en succès) : nécessaire pour simuler la
 *    violation de contrainte unique `client_anonymisation_tenant_client_uk` (migration 0061).
 *  - `select().from().where()` DIRECTEMENT awaitable (`.then`), EN PLUS de `.limit()` : ce module
 *    interroge certaines tables via `.where(...)` seul (`chargerSousCollections`, cinq requêtes
 *    parallèles) et d'autres via `.where(...).limit(1)` (vérification d'existence) — même
 *    distinction que le vrai client Drizzle (`PgSelect` est un thenable, `.limit()` en rend un
 *    autre). Un seul jeu `selects` partagé, consommé dans l'ORDRE d'invocation réelle.
 */
type EvenementExecute = { readonly rows: readonly unknown[] } | { readonly leve: unknown };

function txFactice(plan: {
  selects?: readonly unknown[][];
  executes?: readonly EvenementExecute[];
}) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const executeAppels: unknown[] = [];

  function prochainesLignes(): Promise<unknown[]> {
    return Promise.resolve(selects.shift() ?? []);
  }

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => prochainesLignes(),
          then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
            prochainesLignes().then(resolve, reject),
        }),
      }),
    }),
    execute: vi.fn((requete: unknown) => {
      executeAppels.push(requete);
      const evenement = executes.shift() ?? { rows: [] };
      if ('leve' in evenement) return Promise.reject(evenement.leve);
      return Promise.resolve(evenement);
    }),
  };

  return { tx: tx as unknown as TransactionDfa, executeAppels };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

const CLIENT_ANONYMISE: ReponseClient = {
  id: 'c1',
  numeroClient: 'CL-000001',
  type: 'particulier',
  statut: 'actif',
  civilite: null,
  nom: 'Client anonymisé',
  prenom: null,
  raisonSociale: null,
  nomAffiche: 'Client anonymisé',
  ide: null,
  langueCorrespondance: 'fr',
  email: null,
  telephone: null,
  telephoneE164: null,
  poObligatoire: false,
  groupeId: null,
  fusionneVersClientId: null,
  referenceExterne: null,
  plusAucunContact: true,
  motif: "Anonymisé (droit à l'effacement nLPD).",
  dernierPassageLe: null,
  notesAlerte: [],
  creeLe: '2026-01-01T00:00:00.000Z',
  modifieLe: '2026-08-20T00:00:00.000Z',
};

function serviceClientFactice(): ServiceClient {
  return { parId: vi.fn().mockResolvedValue(CLIENT_ANONYMISE) } as unknown as ServiceClient;
}

const PAGE_VIDE = { donnees: [], curseurSuivant: null, limite: 200 };

function servicesProjectionFactices() {
  return {
    vehicules: {
      lister: vi.fn().mockResolvedValue(PAGE_VIDE),
    } as unknown as ServiceClientVehicules,
    or: {
      lister: vi.fn().mockResolvedValue(PAGE_VIDE),
    } as unknown as ServiceClientOrdresReparation,
  };
}

describe('ServiceClientRgpd.anonymiser', () => {
  it('refuse un rôle hors ROLES_CLIENT_ANONYMISATION (403 DROIT_INSUFFISANT), sans toucher la base', async () => {
    const { tx } = txFactice({});
    const acces = accesFactice(tx);
    const { vehicules, or } = servicesProjectionFactices();
    const service = new ServiceClientRgpd(acces, serviceClientFactice(), vehicules, or);

    await expect(
      service.anonymiser(CTX, 'technicien', 'c1', { motif: 'Demande du client.' }),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('rend 404 RESSOURCE_INTROUVABLE si le client est introuvable POUR CE TENANT (isolation)', async () => {
    // `selects` vide au premier tirage : simule l'absence de ligne — même comportement qu'un
    // clientId d'un AUTRE tenant, jamais distingué d'un id inexistant (404, jamais 403).
    const { tx } = txFactice({ selects: [[]] });
    const acces = accesFactice(tx);
    const { vehicules, or } = servicesProjectionFactices();
    const service = new ServiceClientRgpd(acces, serviceClientFactice(), vehicules, or);

    await expect(
      service.anonymiser(CTX, 'direction', 'c-etranger', { motif: 'Demande du client.' }),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
  });

  it('mappe la violation de contrainte unique en 409 CLIENT_DEJA_ANONYMISE (idempotence en base)', async () => {
    const violation = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'client_anonymisation_tenant_client_uk',
    });
    const { tx } = txFactice({ selects: [[{ id: 'c1' }]], executes: [{ leve: violation }] });
    const acces = accesFactice(tx);
    const { vehicules, or } = servicesProjectionFactices();
    const service = new ServiceClientRgpd(acces, serviceClientFactice(), vehicules, or);

    await expect(
      service.anonymiser(CTX, 'direction', 'c1', { motif: 'Demande du client.' }),
    ).rejects.toMatchObject({ code: 'CLIENT_DEJA_ANONYMISE' });
  });

  it("propage toute AUTRE erreur d'insertion sans la travestir en CLIENT_DEJA_ANONYMISE", async () => {
    const autreErreur = Object.assign(new Error('autre chose'), { code: '23503' });
    const { tx } = txFactice({ selects: [[{ id: 'c1' }]], executes: [{ leve: autreErreur }] });
    const acces = accesFactice(tx);
    const { vehicules, or } = servicesProjectionFactices();
    const service = new ServiceClientRgpd(acces, serviceClientFactice(), vehicules, or);

    await expect(
      service.anonymiser(CTX, 'admin', 'c1', { motif: 'Demande du client.' }),
    ).rejects.toBe(autreErreur);
  });

  it('pour un rôle autorisé, trace puis appelle la fonction base, tenant/client scopés, puis relit la fiche', async () => {
    const { tx, executeAppels } = txFactice({
      selects: [[{ id: 'c1' }]],
      executes: [{ rows: [] }, { rows: [] }],
    });
    const acces = accesFactice(tx);
    const serviceClient = serviceClientFactice();
    const { vehicules, or } = servicesProjectionFactices();
    const service = new ServiceClientRgpd(acces, serviceClient, vehicules, or);

    const resultat = await service.anonymiser(CTX, 'direction', 'c1', {
      motif: 'Demande écrite du client, art. 32 nLPD.',
    });

    expect(resultat).toBe(CLIENT_ANONYMISE);
    expect(executeAppels).toHaveLength(2);
    // Chaque instruction porte le TENANT et le CLIENT visés — jamais une portée globale, même sous
    // une fonction base security definer (voir migration 0061).
    const premierAppel = JSON.stringify(executeAppels[0]);
    const secondAppel = JSON.stringify(executeAppels[1]);
    expect(premierAppel).toContain('client_anonymisation');
    expect(secondAppel).toContain('anonymiser_client_donnees');
    expect(premierAppel).toContain('tid-1');
    expect(secondAppel).toContain('tid-1');
    expect(secondAppel).toContain('c1');
    expect(serviceClient.parId).toHaveBeenCalledWith(CTX, 'c1');
  });
});

describe('ServiceClientRgpd.exporter', () => {
  /** Exists-check (chargerSousCollections) + 5 sous-collections vides, ordre non significatif. */
  const SELECTS_CLIENT_TROUVE = [[{ id: 'c1' }], [], [], [], [], []];
  const EXECUTES_TROIS_SECTIONS = [{ rows: [] }, { rows: [] }, { rows: [] }];

  function pageVehicule(id: string, curseurSuivant: string | null) {
    return {
      donnees: [
        {
          id,
          plaque: null,
          canton: null,
          designation: 'VW Golf',
          vin: null,
          premiereMiseEnCirculationLe: null,
          identificationIncomplete: false,
          emplacementLibre: null,
        } satisfies VehiculeResume,
      ],
      curseurSuivant,
      limite: 200,
    };
  }

  it('boucle sur ServiceClientVehicules.lister jusqu’à épuisement du curseur — jamais tronqué à la 1ère page', async () => {
    const { tx } = txFactice({ selects: SELECTS_CLIENT_TROUVE, executes: EXECUTES_TROIS_SECTIONS });
    const acces = accesFactice(tx);
    const serviceClient = serviceClientFactice();
    const listerVehicules = vi
      .fn()
      .mockResolvedValueOnce(pageVehicule('v1', 'curseur-page-2'))
      .mockResolvedValueOnce(pageVehicule('v2', null));
    const serviceVehicules = { lister: listerVehicules } as unknown as ServiceClientVehicules;
    const serviceOr = {
      lister: vi.fn().mockResolvedValue(PAGE_VIDE),
    } as unknown as ServiceClientOrdresReparation;

    const service = new ServiceClientRgpd(acces, serviceClient, serviceVehicules, serviceOr);
    const export_ = await service.exporter(CTX, 'c1');

    expect(listerVehicules).toHaveBeenCalledTimes(2);
    expect(export_.vehicules.map((v) => v.id)).toEqual(['v1', 'v2']);
  });

  it('boucle de la même façon sur ServiceClientOrdresReparation.lister, avecMontants=true', async () => {
    const { tx } = txFactice({ selects: SELECTS_CLIENT_TROUVE, executes: EXECUTES_TROIS_SECTIONS });
    const acces = accesFactice(tx);
    const serviceClient = serviceClientFactice();
    const serviceVehicules = {
      lister: vi.fn().mockResolvedValue(PAGE_VIDE),
    } as unknown as ServiceClientVehicules;
    function pageOr(id: string, curseurSuivant: string | null) {
      return { donnees: [{ id } as unknown as OrdreReparationResume], curseurSuivant, limite: 200 };
    }
    const listerOr = vi
      .fn()
      .mockResolvedValueOnce(pageOr('or1', 'curseur-page-2'))
      .mockResolvedValueOnce(pageOr('or2', null));
    const serviceOr = { lister: listerOr } as unknown as ServiceClientOrdresReparation;

    const service = new ServiceClientRgpd(acces, serviceClient, serviceVehicules, serviceOr);
    const export_ = await service.exporter(CTX, 'c1');

    expect(listerOr).toHaveBeenCalledTimes(2);
    expect(listerOr.mock.calls[0]?.[3]).toBe(true);
    expect(export_.ordresReparation.map((o) => o.id)).toEqual(['or1', 'or2']);
  });

  it("rend 404 RESSOURCE_INTROUVABLE si le client n'existe pas pour ce tenant", async () => {
    const { tx } = txFactice({ selects: [[]] });
    const acces = accesFactice(tx);
    const { vehicules, or } = servicesProjectionFactices();
    const service = new ServiceClientRgpd(acces, serviceClientFactice(), vehicules, or);

    await expect(service.exporter(CTX, 'c-etranger')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});
