import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { EntreeAdresseClient, EntreeConditionClient, EntreeConsentementClient } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { ServiceClientSousCollections } from './service-client-sous-collections';
import type { ParametresPageSousCollection } from './schemas';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const dialect = new PgDialect();
const PAGE: ParametresPageSousCollection = { limite: 20 };

/**
 * Fausse transaction : `select().from().where().limit()` rend, DANS L'ORDRE, les jeux fournis ;
 * `insert().values().returning()` rend, dans l'ordre, soit un jeu de lignes soit lève l'erreur
 * posée (pour simuler une violation de contrainte Postgres — 23505 unique, 23P01 exclusion).
 */
function txFactice(plan: { selects?: readonly unknown[][] } = {}) {
  const selects = [...(plan.selects ?? [])];
  const whereArgs: unknown[] = [];
  const insertValuesArgs: Array<Record<string, unknown>> = [];
  const updateSetArgs: unknown[] = [];
  const suiteInsertReturning: Array<() => unknown[]> = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereArgs.push(cond);
          // Deux formes utilisées selon l'appel : `.where().limit()` (vérification d'existence)
          // et `.where().orderBy().limit()` (listes paginées) — les deux doivent aboutir à la
          // même file de résultats, dans l'ordre des appels.
          const resoudre = () => Promise.resolve(selects.shift() ?? []);
          return { limit: resoudre, orderBy: () => ({ limit: resoudre }) };
        },
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return {
          returning: async () => {
            const prochain = suiteInsertReturning.shift();
            if (!prochain) return [];
            return prochain();
          },
        };
      },
    }),
    update: (_table: unknown) => ({
      set: (vals: unknown) => {
        updateSetArgs.push(vals);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
  };

  return {
    tx: tx as unknown as TransactionDfa,
    whereArgs,
    insertValuesArgs,
    updateSetArgs,
    poserRetourInsert: (lignes: unknown[]) => suiteInsertReturning.push(() => lignes),
    poserErreurInsert: (erreur: unknown) =>
      suiteInsertReturning.push(() => {
        throw erreur;
      }),
  };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceClientSousCollections.creerCondition — conditions commerciales DATÉES (RM-07)', () => {
  it('les bornes de validité envoyées (valideDuLe/valideAuLe) sont écrites telles quelles, sans recalcul', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({ selects: [[{ id: 'c1' }]] });
    poserRetourInsert([
      {
        id: 'cd1',
        tenantId: 'tid-1',
        clientId: 'c1',
        rabaisMoPourmille: 50,
        rabaisPiecesPourmille: 0,
        rabaisPneusPourmille: 0,
        tauxHoraireCode: null,
        delaiPaiementJours: null,
        modePaiement: null,
        plafondCentimes: null,
        valideDu: '2026-01-01',
        valideAu: '2026-06-30',
        creeLe: new Date('2026-01-01T00:00:00.000Z'),
        modifieLe: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const service = new ServiceClientSousCollections(accesFactice(tx));
    const entree: EntreeConditionClient = {
      rabaisMoPourmille: 50,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      valideDuLe: '2026-01-01',
      valideAuLe: '2026-06-30',
    };

    const enveloppe = await service.creerCondition(CTX, 'c1', entree);

    expect(enveloppe.donnees.valideDuLe).toBe('2026-01-01');
    expect(enveloppe.donnees.valideAuLe).toBe('2026-06-30');
    expect(insertValuesArgs[0]).toMatchObject({ valideDu: '2026-01-01', valideAu: '2026-06-30' });
  });

  it("une période qui chevauche une condition déjà en vigueur est un 400 VALIDATION_ECHOUEE — jamais un 409, ce n'est pas un conflit de ressource (RM-07, CT-03)", async () => {
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    fabrique.poserErreurInsert({ code: '23P01', constraint: 'client_condition_periode_excl' });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx));

    const entree: EntreeConditionClient = {
      rabaisMoPourmille: 0,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      valideDuLe: '2026-01-01',
      valideAuLe: null,
    };

    const erreur = await service.creerCondition(CTX, 'c1', entree).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe('periode_chevauchement');
  });
});

describe('ServiceClientSousCollections.creerAdresse — une seule adresse active par type (RM-03)', () => {
  it("une deuxième adresse principale active en même temps est refusée en 400, nommant le type en cause", async () => {
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    fabrique.poserErreurInsert({ code: '23505', constraint: 'client_adresse_principale_uk' });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx));
    const entree: EntreeAdresseClient = {
      type: 'principale',
      rue: 'Rue Neuve 2',
      complement: null,
      npa: '1200',
      localite: 'Genève',
      pays: 'CH',
    };

    const erreur = await service.creerAdresse(CTX, 'c1', entree).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ message: string }> }).erreurs[0]?.message).toContain('principale');
  });

  it("l'adresse créée est scopée au tenant du contexte et au client demandé", async () => {
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    fabrique.poserRetourInsert([
      {
        id: 'a1',
        tenantId: 'tid-1',
        clientId: 'c1',
        type: 'principale',
        rue: 'Rue Neuve 2',
        complement: null,
        npa: '1200',
        localite: 'Genève',
        pays: 'CH',
        actif: true,
        creeLe: new Date('2026-01-01T00:00:00.000Z'),
        modifieLe: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx));

    await service.creerAdresse(CTX, 'c1', {
      type: 'principale',
      rue: 'Rue Neuve 2',
      complement: null,
      npa: '1200',
      localite: 'Genève',
      pays: 'CH',
    });

    expect(fabrique.insertValuesArgs[0]).toMatchObject({ tenantId: 'tid-1', clientId: 'c1' });
  });
});

describe('ServiceClientSousCollections.creerConsentement — append-only, jamais de mise à jour (RM-09, nLPD)', () => {
  it('une révocation (accorde: false) insère une NOUVELLE ligne — aucune ligne existante ne doit être modifiée', async () => {
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    fabrique.poserRetourInsert([
      {
        id: 'cs1',
        tenantId: 'tid-1',
        clientId: 'c1',
        type: 'marketing_email',
        accorde: false,
        recueilliLe: new Date('2026-07-01T00:00:00.000Z'),
        canal: 'comptoir',
        preuve: null,
        creeLe: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx));
    const entree: EntreeConsentementClient = {
      type: 'marketing_email',
      accorde: false,
      recueilliLe: '2026-07-01T00:00:00.000Z',
      canal: 'comptoir',
    };

    const enveloppe = await service.creerConsentement(CTX, 'c1', entree);

    expect(enveloppe.donnees.accorde).toBe(false);
    expect(fabrique.updateSetArgs).toHaveLength(0);
  });
});

describe('ServiceClientSousCollections — isolation tenant sur les sous-collections', () => {
  it("un clientId qui n'existe pas pour le tenant du contexte est 404 RESSOURCE_INTROUVABLE, sur toute sous-collection", async () => {
    const fabrique = txFactice({ selects: [[]] });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx));

    await expect(service.listerAdresses(CTX, 'c-autre-tenant', PAGE)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('la vérification d\'existence du client filtre sur le tenantId du CONTEXTE, en plus de son id', async () => {
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx));

    await service.listerAdresses(CTX, 'c1', PAGE);

    // Deux lectures : la vérification d'existence du client, puis la liste paginée des adresses —
    // la PREMIÈRE est celle de la vérification d'existence, elle aussi scopée au tenant.
    expect(fabrique.whereArgs.length).toBeGreaterThanOrEqual(1);
    const { sql: texte, params } = dialect.sqlToQuery(fabrique.whereArgs[0] as SQL);
    expect(texte).toContain('tenant_id');
    expect(params).toContain('tid-1');
  });
});
