import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntreeMarquerVenduVehiculeStock } from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../db';
import { vehiculeStock } from '../db/schema';
import type { LigneVehiculeStock } from '../db/schema';
import type { Horloge } from '../common/horloge/horloge';

import { ServiceVehiculeStock, estViolationCleUnique } from './service-vehicule-stock';

/**
 * Trou n°2 comblé (audit préalable, rapport de livraison) : `transition_autorisee` autorise déjà
 * `vehicule_stock` `reserve -> vendu` en base (`migrations/0032_ventes.sql` §9) mais AUCUN code de
 * ce dépôt ne pouvait jamais la déclencher — `service-dossier-vente.ts::livrer()` EXIGE ce statut
 * sans qu'aucun chemin ne puisse jamais le produire (`grep` préalable : `venduLe`/`vendu_le` en
 * lecture seule dans tout `ventes/`, `facturation/` ne référence jamais `vehiculeStock`). Ce
 * fichier prouve `marquerVendu` (base MOQUÉE, même doctrine que `pieces/service-stock.spec.ts`) :
 * la transition pose bien `venduLe` et le motif, et refuse proprement (409 CONFLIT) depuis tout
 * autre statut que `reserve` plutôt que d'écraser silencieusement un statut incohérent.
 */
const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'user-1', requeteId: null };
const VEHICULE_ID = 'veh-1';
const MAINTENANT = new Date('2026-08-01T10:00:00.000Z');

function horlogeFactice(): Horloge {
  return { maintenant: () => MAINTENANT } as unknown as Horloge;
}

function ligneReserveeFixture(champs: Partial<LigneVehiculeStock> = {}): LigneVehiculeStock {
  return {
    id: VEHICULE_ID,
    tenantId: 'tid-1',
    siteId: 'site-1',
    provenance: 'achat_particulier',
    dateEntreeStock: '2026-07-01',
    prixAchatCentimes: 1_200_000,
    prixVenteAfficheCentimes: 1_500_000,
    statutCommercial: 'reserve',
    vendeurPrecedentAssujetti: null,
    origineRepriseDossierVenteId: null,
    dernierMotifTransition: null,
    receptionneLe: new Date('2026-07-01T08:00:00.000Z'),
    reserveLe: new Date('2026-07-20T08:00:00.000Z'),
    venduLe: null,
    livreLe: null,
    version: 2,
    creeLe: new Date('2026-07-01T08:00:00.000Z'),
    modifieLe: new Date('2026-07-20T08:00:00.000Z'),
    ...champs,
  } as LigneVehiculeStock;
}

/** Fausse transaction couvrant `select().from().where().limit()` (chargement, éventuellement
 *  `.for('update')`) et `update().set().where()` — même patron que `pieces/service-stock.spec.ts`.
 *  `limit()` rend un objet « thenable » (à la fois `await`-able directement ET chaînable via
 *  `.for('update')`) pour coller aux deux formes utilisées par `references.ts::chargerVehiculeStockOuNull`. */
function txFactice(selects: readonly unknown[][] = []) {
  const files = [...selects];
  const updateCalls: Array<{ table: unknown; champs: unknown }> = [];

  const resultatLimit = () => {
    let consomme: Promise<unknown[]> | null = null;
    const consommer = () => (consomme ??= Promise.resolve(files.shift() ?? []));
    return {
      for: () => consommer(),
      then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
        consommer().then(resolve, reject),
    };
  };

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => resultatLimit() }),
      }),
    }),
    update: (table: unknown) => ({
      set: (champs: unknown) => {
        updateCalls.push({ table, champs });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };

  return { tx: tx as unknown as TransactionDfa, updateCalls };
}

function accesFactice(tx: TransactionDfa) {
  return {
    enTenant: vi.fn(
      async (_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
        travail(tx),
    ),
  };
}

function serviceFactice(tx: TransactionDfa): ServiceVehiculeStock {
  const svc = new ServiceVehiculeStock(
    accesFactice(tx) as never,
    {} as never,
    {} as never,
    horlogeFactice(),
  );
  // `assembler` est privé — seule façon de l'atteindre depuis ce fichier de test (cast `any`
  // assumé). Ce fichier n'exerce que l'effet de bord ajouté (`marquerVendu`), pas le ré-assemblage
  // complet de la fiche stock (clients, plaque, audit — déjà exercé ailleurs).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(svc as any, 'assembler').mockResolvedValue({} as never);
  return svc;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ServiceVehiculeStock.marquerVendu — `reserve -> vendu` (trou comblé)', () => {
  it('depuis `reserve` : pose `venduLe`, `statutCommercial = vendu` et trace le motif', async () => {
    // 1er select : chargerVehiculeStockPourEcriture (verrouillé) ; 2e : chargerVehiculeStock (relecture).
    const { tx, updateCalls } = txFactice([
      [ligneReserveeFixture()],
      [ligneReserveeFixture({ statutCommercial: 'vendu', venduLe: MAINTENANT })],
    ]);
    const service = serviceFactice(tx);

    const entree: EntreeMarquerVenduVehiculeStock = {
      motif: 'Facture n°2026-042 émise — resynchronisation manuelle.',
    };
    await service.marquerVendu(CTX, 'direction', VEHICULE_ID, entree);

    const misAJour = updateCalls.find((c) => c.table === vehiculeStock);
    expect(misAJour?.champs).toMatchObject({
      statutCommercial: 'vendu',
      venduLe: MAINTENANT,
      dernierMotifTransition: entree.motif,
    });
  });

  it("refuse (409 CONFLIT) depuis un statut autre que `reserve` — n'écrase pas un état incohérent", async () => {
    const { tx, updateCalls } = txFactice([
      [ligneReserveeFixture({ statutCommercial: 'disponible' })],
    ]);
    const service = serviceFactice(tx);

    const entree: EntreeMarquerVenduVehiculeStock = { motif: 'Tentative hors séquence.' };
    await expect(service.marquerVendu(CTX, 'direction', VEHICULE_ID, entree)).rejects.toMatchObject(
      { code: 'CONFLIT' },
    );
    expect(updateCalls).toHaveLength(0);
  });
});

/**
 * RPP-06 (`docs/specification-parc-et-hangar-pneus.md`) : la vente ne transfère JAMAIS
 * automatiquement au nouveau propriétaire un éventuel dépôt de pneus rattaché au véhicule —
 * signalement, jamais un blocage. `ServiceVehiculeStock.marquerVendu` lit `depot_pneus` en LECTURE
 * SEULE (module `pneus/`, hors périmètre d'écriture de ce lot) et n'ajoute qu'un avertissement
 * `VEHICULE_DEPOTS_PNEUS_OUVERTS` — la vente aboutit dans tous les cas, avec ou sans dépôt.
 */
describe('ServiceVehiculeStock.marquerVendu — RPP-06 (signalement des dépôts pneus ouverts)', () => {
  it('cas nominal : des jeux actifs (en_depot/monte/a_relancer) sont signalés SANS bloquer la vente', async () => {
    // 1er select : chargerVehiculeStockPourEcriture ; 2e : chargerVehiculeStock (relecture) ;
    // 3e : signalerDepotsPneusOuverts (dépôts actifs pour ce véhicule).
    const depotsOuverts = [
      { id: 'depot-ete-1', saison: 'ete', statut: 'en_depot' },
      { id: 'depot-hiver-1', saison: 'hiver', statut: 'monte' },
    ];
    const { tx, updateCalls } = txFactice([
      [ligneReserveeFixture()],
      [ligneReserveeFixture({ statutCommercial: 'vendu', venduLe: MAINTENANT })],
      depotsOuverts,
    ]);
    const service = serviceFactice(tx);

    const entree: EntreeMarquerVenduVehiculeStock = { motif: 'Facture n°2026-050 émise.' };
    const resultat = await service.marquerVendu(CTX, 'direction', VEHICULE_ID, entree);

    // La vente a bien eu lieu — le signalement n'est jamais un blocage.
    expect(updateCalls.find((c) => c.table === vehiculeStock)?.champs).toMatchObject({
      statutCommercial: 'vendu',
    });
    expect(resultat.avertissements).toEqual([
      {
        code: 'VEHICULE_DEPOTS_PNEUS_OUVERTS',
        message: expect.stringContaining('2 dépôt'),
        donnees: { depotsOuverts },
      },
    ]);
  });

  it("cas « véhicule vendu sans aucun dépôt » : n'ajoute aucun avertissement et ne lève pas", async () => {
    const { tx, updateCalls } = txFactice([
      [ligneReserveeFixture()],
      [ligneReserveeFixture({ statutCommercial: 'vendu', venduLe: MAINTENANT })],
      [],
    ]);
    const service = serviceFactice(tx);

    const entree: EntreeMarquerVenduVehiculeStock = { motif: 'Facture n°2026-051 émise.' };
    const resultat = await service.marquerVendu(CTX, 'direction', VEHICULE_ID, entree);

    expect(updateCalls.find((c) => c.table === vehiculeStock)?.champs).toMatchObject({
      statutCommercial: 'vendu',
    });
    expect(resultat.avertissements).toEqual([]);
  });
});

/**
 * Bug corrigé (audit 2026-08-04) : `estViolationCleUnique` testait `erreur.code` au premier
 * niveau, mais Drizzle enveloppe SYSTÉMATIQUEMENT l'erreur `pg` brute dans une `DrizzleQueryError`
 * (`code` sous `.cause`, jamais en surface) — deux mises en stock concurrentes du même véhicule
 * (PK `vehicule_stock.id`) rendaient donc 500 `ERREUR_INTERNE` au lieu de 409
 * `VENTE_VEHICULE_STOCK_DEJA_EXISTANT`. Voir `common/erreurs-pg/remonter-cause-pg.ts`.
 */
describe('estViolationCleUnique', () => {
  it('reconnaît un 23505 enveloppé sous .cause (forme réelle Drizzle)', () => {
    const brute = new Error('duplicate key') as Error & { code: string };
    brute.code = '23505';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationCleUnique(enveloppee)).toBe(true);
  });

  it('ne reconnaît pas un autre SQLSTATE enveloppé (ex. 23503, contrainte non concernée)', () => {
    const brute = new Error('foreign key violation') as Error & { code: string };
    brute.code = '23503';
    const enveloppee = new Error('Failed query') as Error & { cause: unknown };
    enveloppee.cause = brute;

    expect(estViolationCleUnique(enveloppee)).toBe(false);
  });
});
