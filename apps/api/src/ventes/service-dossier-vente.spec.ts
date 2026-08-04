import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreeActionLivrer } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import { vehiculeDetention, vehiculeStock } from '../db/schema';
import type { LigneDossierVente, LigneReprise, LigneVehiculeStock } from '../db/schema';
import type { Horloge } from '../common/horloge/horloge';

/**
 * Trou n°1 comblé (audit préalable, rapport de livraison) : `POST /dossiers-vente/{id}/livrer`
 * n'implémentait que l'effet de bord « détention » sur les 3 documentés par
 * `contrats/ventes/dossier-vente.ts::schemaActionLivrer` — la mise en stock automatique de la
 * reprise confirmée (RV-24) n'était écrite NULLE PART (`origineRepriseDossierVenteId` était
 * seulement LU dans tout le module, jamais ÉCRIT). Ce fichier prouve, base MOQUÉE (`./references`
 * mocké, même doctrine que `atelier/service-or.spec.ts`) : la reprise CONFIRMÉE entre en stock à sa
 * valeur NÉGOCIÉE (jamais estimée, RV-24 littéral), avec la bonne provenance/origine, la reprise
 * NON confirmée n'y entre jamais, et le doublon (véhicule repris déjà en stock) est refusé proprement
 * plutôt que de laisser fuiter une violation SQL brute.
 *
 * `assembler()` (privé, ré-assemble tout le document — clients, financements, documents, audit) est
 * COURT-CIRCUITÉ via `vi.spyOn` : ce fichier n'exerce QUE l'effet de bord ajouté, pas le reste du
 * document déjà exercé ailleurs (mêmes principes que `service-or.spec.ts` pour `assemblerDocument`,
 * qui est public là-bas — ici privé, d'où le cast `any` assumé, seule façon d'atteindre la méthode
 * depuis un fichier de test externe).
 */
vi.mock('./references', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./references')>();
  return {
    ...reel,
    chargerDossierVente: vi.fn(),
    chargerDossierVentePourEcriture: vi.fn(),
    chargerVehiculeStockPourEcriture: vi.fn(),
    chargerVehiculeStockOuNull: vi.fn(),
    chargerRepriseParDossierOuNull: vi.fn(),
  };
});

import { ServiceDossierVente } from './service-dossier-vente';
import * as references from './references';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'user-1', requeteId: null };
const DOSSIER_ID = 'dossier-1';
const VEHICULE_VENDU_ID = 'veh-vendu-1';
const VEHICULE_REPRIS_ID = 'veh-repris-1';
const MAINTENANT = new Date('2026-08-01T10:00:00.000Z');

const ENTREE: EntreeActionLivrer = {
  dateLivraisonEffective: '2026-08-01',
  kilometrageDepart: 12,
  uniteKilometrage: 'km',
};

function horlogeFactice(): Horloge {
  return { maintenant: () => MAINTENANT } as unknown as Horloge;
}

function dossierFixture(champs: Partial<LigneDossierVente> = {}): LigneDossierVente {
  return {
    id: DOSSIER_ID,
    tenantId: 'tid-1',
    siteId: 'site-1',
    statut: 'pret_a_livrer',
    vehiculeId: VEHICULE_VENDU_ID,
    clientAcheteurId: 'client-acheteur-1',
    clientFactureId: null,
    clientConducteurId: null,
    dateLivraisonEstimee: null,
    dateLivraisonEffective: null,
    identitePieceType: 'carte_identite',
    identiteVerifieeLe: new Date('2026-07-20T09:00:00.000Z'),
    engageLe: new Date('2026-07-20T09:00:00.000Z'),
    enPreparationLe: new Date('2026-07-21T09:00:00.000Z'),
    pretALivrerLe: new Date('2026-07-25T09:00:00.000Z'),
    livreLe: null,
    closLe: null,
    annuleLe: null,
    abandonneLe: null,
    motifCloture: null,
    version: 4,
    creeLe: new Date('2026-07-15T08:00:00.000Z'),
    modifieLe: new Date('2026-07-25T09:00:00.000Z'),
    ...champs,
  } as LigneDossierVente;
}

function vehiculeStockVenduFixture(champs: Partial<LigneVehiculeStock> = {}): LigneVehiculeStock {
  return {
    id: VEHICULE_VENDU_ID,
    tenantId: 'tid-1',
    siteId: 'site-1',
    provenance: 'neuf_constructeur',
    dateEntreeStock: '2026-06-01',
    prixAchatCentimes: 2_000_000,
    prixVenteAfficheCentimes: 2_500_000,
    statutCommercial: 'vendu',
    vendeurPrecedentAssujetti: null,
    origineRepriseDossierVenteId: null,
    dernierMotifTransition: null,
    receptionneLe: new Date('2026-06-01T08:00:00.000Z'),
    reserveLe: new Date('2026-07-01T08:00:00.000Z'),
    venduLe: new Date('2026-07-20T08:00:00.000Z'),
    livreLe: null,
    version: 3,
    creeLe: new Date('2026-06-01T08:00:00.000Z'),
    modifieLe: new Date('2026-07-20T08:00:00.000Z'),
    ...champs,
  } as LigneVehiculeStock;
}

function repriseFixture(champs: Partial<LigneReprise> = {}): LigneReprise {
  return {
    id: 'reprise-1',
    tenantId: 'tid-1',
    dossierVenteId: DOSSIER_ID,
    vehiculeRepriseId: VEHICULE_REPRIS_ID,
    statut: 'confirmee',
    valeurEstimeeCentimes: 800_000,
    valeurNegocieeCentimes: 750_000,
    detteFinancementResiduelleCentimes: null,
    detteFinancementOrganismeId: null,
    detteFinancementOrganismeNom: null,
    motifRefus: null,
    estimeeLe: new Date('2026-07-01T08:00:00.000Z'),
    negocieeLe: new Date('2026-07-05T08:00:00.000Z'),
    confirmeeLe: new Date('2026-07-20T09:00:00.000Z'),
    refuseeLe: null,
    version: 3,
    creeLe: new Date('2026-07-01T08:00:00.000Z'),
    modifieLe: new Date('2026-07-20T09:00:00.000Z'),
    ...champs,
  } as LigneReprise;
}

interface AppelInsert {
  readonly table: unknown;
  readonly valeurs: unknown;
}
interface AppelUpdate {
  readonly table: unknown;
  readonly champs: unknown;
}

/** Fausse transaction : seuls `select().from().where().limit()`, `update().set().where()` et
 *  `insert().values()` sont exercés par `livrer()` (hors ce qui passe par `./references`, mocké). */
function txFactice(selects: readonly unknown[][] = []) {
  const files = [...selects];
  const insertCalls: AppelInsert[] = [];
  const updateCalls: AppelUpdate[] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(files.shift() ?? []) }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (valeurs: unknown) => {
        insertCalls.push({ table, valeurs });
        return Promise.resolve(undefined);
      },
    }),
    update: (table: unknown) => ({
      set: (champs: unknown) => {
        updateCalls.push({ table, champs });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };

  return { tx: tx as unknown as TransactionDfa, insertCalls, updateCalls };
}

function accesFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

function serviceFactice(acces: ReturnType<typeof accesFactice>): ServiceDossierVente {
  const svc = new ServiceDossierVente(acces as never, {} as never, {} as never, horlogeFactice());
  // `assembler` est privé — seule façon de l'atteindre depuis ce fichier de test, même principe
  // que `service-or.spec.ts` pour `assemblerDocument` (public là-bas).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(svc as any, 'assembler').mockResolvedValue({} as never);
  return svc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceDossierVente.livrer — RV-24 : mise en stock automatique de la reprise confirmée', () => {
  it('sans reprise sur ce dossier : aucune écriture vehicule_stock pour un véhicule repris', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(null);
    vi.mocked(references.chargerDossierVente).mockResolvedValue(
      dossierFixture({ statut: 'livre' }),
    );

    const { tx, insertCalls } = txFactice([[]]); // 1 select : détention ouverte du véhicule vendu
    const svc = serviceFactice(accesFactice(tx));

    await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it("reprise NÉGOCIÉE (pas encore confirmée) : n'entre PAS en stock à la livraison", async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(
      repriseFixture({ statut: 'negociee', confirmeeLe: null }),
    );
    vi.mocked(references.chargerDossierVente).mockResolvedValue(
      dossierFixture({ statut: 'livre' }),
    );

    const { tx, insertCalls } = txFactice([[]]);
    const svc = serviceFactice(accesFactice(tx));

    await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it('reprise CONFIRMÉE : entre en stock à la valeur NÉGOCIÉE (jamais estimée), provenance `reprise`, origine tracée, détention clôturée sans réouverture', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(repriseFixture());
    vi.mocked(references.chargerVehiculeStockOuNull).mockResolvedValue(null); // pas encore en stock
    vi.mocked(references.chargerDossierVente).mockResolvedValue(
      dossierFixture({ statut: 'livre' }),
    );

    // 2 selects attendus, dans l'ordre : détention du véhicule VENDU, puis détention du véhicule REPRIS.
    const { tx, insertCalls, updateCalls } = txFactice([
      [{ id: 'detention-vendu-1' }],
      [{ id: 'detention-reprise-1' }],
    ]);
    const svc = serviceFactice(accesFactice(tx));

    await svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE);

    const insertVehiculeStock = insertCalls.find((c) => c.table === vehiculeStock);
    expect(insertVehiculeStock?.valeurs).toMatchObject({
      id: VEHICULE_REPRIS_ID,
      tenantId: 'tid-1',
      siteId: 'site-1',
      provenance: 'reprise',
      prixAchatCentimes: 750_000, // valeurNegocieeCentimes — JAMAIS valeurEstimeeCentimes (800_000)
      dateEntreeStock: '2026-08-01',
      statutCommercial: 'disponible',
      origineRepriseDossierVenteId: DOSSIER_ID,
    });

    const clotureDetentionReprise = updateCalls.find(
      (c) =>
        c.table === vehiculeDetention && (c.champs as { motifFin?: string }).motifFin === 'reprise',
    );
    expect(clotureDetentionReprise?.champs).toMatchObject({
      au: '2026-08-01',
      motifFin: 'reprise',
    });

    // Pas de réouverture au nom d'un détenteur cible pour le véhicule repris (`QV-01` non tranché) :
    // un seul insert `vehicule_detention` — celui du véhicule VENDU (nouveau détenteur, RV-53).
    const insertsDetention = insertCalls.filter((c) => c.table === vehiculeDetention);
    expect(insertsDetention).toHaveLength(1);
  });

  it('véhicule repris déjà en stock : 409 VENTE_VEHICULE_STOCK_DEJA_EXISTANT, aucune écriture vehicule_stock', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(repriseFixture());
    vi.mocked(references.chargerVehiculeStockOuNull).mockResolvedValue(
      vehiculeStockVenduFixture({ id: VEHICULE_REPRIS_ID }),
    );

    const { tx, insertCalls } = txFactice([[]]);
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE)).rejects.toMatchObject({
      code: 'VENTE_VEHICULE_STOCK_DEJA_EXISTANT',
    });
    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it('reprise confirmée sans valeur négociée (incohérence de données, ne devrait jamais arriver) : ERREUR_INTERNE plutôt qu’un centime `null` silencieux', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture(),
    );
    vi.mocked(references.chargerRepriseParDossierOuNull).mockResolvedValue(
      repriseFixture({ valeurNegocieeCentimes: null }),
    );

    const { tx, insertCalls } = txFactice([[]]);
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE)).rejects.toMatchObject({
      code: 'ERREUR_INTERNE',
    });
    expect(insertCalls.filter((c) => c.table === vehiculeStock)).toHaveLength(0);
  });

  it('livraison refusée si le véhicule vendu n’est pas encore facturé (`vendu`) — garde déjà en place, non régressée', async () => {
    vi.mocked(references.chargerDossierVentePourEcriture).mockResolvedValue(dossierFixture());
    vi.mocked(references.chargerVehiculeStockPourEcriture).mockResolvedValue(
      vehiculeStockVenduFixture({ statutCommercial: 'reserve' }),
    );

    const { tx } = txFactice([]);
    const svc = serviceFactice(accesFactice(tx));

    await expect(svc.livrer(CTX, 'direction', DOSSIER_ID, ENTREE)).rejects.toMatchObject({
      code: 'VENTE_VEHICULE_INDISPONIBLE',
    });
  });
});
