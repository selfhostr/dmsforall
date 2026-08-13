import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type {
  EntreeAdresseClient,
  EntreeConditionClient,
  EntreeConsentementClient,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneTauxHoraire } from '../db/schema';
import type { ServiceJournal } from '../common/journal';
import { ServiceClientSousCollections } from './service-client-sous-collections';
import type { ParametresPageSousCollection } from './schemas';

/** #72 : ligne `taux_horaire` factice — voir `ligneFixture`/`tauxHoraireFixture` de
 *  `atelier/service-ligne-or.spec.ts` pour le même patron (référentiel réutilisé, pas réinventé). */
function tauxHoraireFixture(overrides: Partial<LigneTauxHoraire> = {}): LigneTauxHoraire {
  return {
    id: 'th-1',
    tenantId: 'tid-1',
    code: 'ATELIER',
    libelle: 'Taux horaire atelier',
    montantCentimes: 13_500,
    valideDu: '2020-01-01',
    valideAu: null,
    creeLe: new Date('2020-01-01T00:00:00.000Z'),
    modifieLe: new Date('2020-01-01T00:00:00.000Z'),
    ...overrides,
  } as LigneTauxHoraire;
}

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const dialect = new PgDialect();
const PAGE: ParametresPageSousCollection = { limite: 20 };

/**
 * Fausse transaction : `select().from().where().limit()` rend, DANS L'ORDRE, les jeux fournis ;
 * `insert().values().returning()` rend, dans l'ordre, soit un jeu de lignes soit lève l'erreur
 * posée (pour simuler une violation de contrainte Postgres — 23505 unique, 23P01 exclusion) ;
 * `update().set().where()` résout normalement, sauf erreur posée via `poserErreurUpdate` (pour
 * simuler une panne d'infrastructure non liée à une contrainte reconnue — F-01).
 */
function txFactice(plan: { selects?: readonly unknown[][] } = {}) {
  const selects = [...(plan.selects ?? [])];
  const whereArgs: unknown[] = [];
  const insertValuesArgs: Array<Record<string, unknown>> = [];
  const updateSetArgs: unknown[] = [];
  const suiteInsertReturning: Array<() => unknown[]> = [];
  const suiteUpdateWhere: Array<() => void> = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereArgs.push(cond);
          // Trois formes utilisées selon l'appel : `.where().limit()` (vérification d'existence),
          // `.where().orderBy().limit()` (listes paginées), et `.where()` attendu DIRECTEMENT sans
          // `.limit()` (ex. `atelier/taux-horaire.ts::chargerToutesTauxHoraire` — lecture complète
          // d'une petite table, même patron que le VRAI query builder Drizzle : `await
          // tx.select().from(t).where(cond)` fonctionne sans `.limit()`, car chaque étape est
          // elle-même `PromiseLike`). Les trois doivent consommer EXACTEMENT une entrée de la file
          // par `.where()` — `resoudre` est donc MÉMOÏSÉ ici (un seul `selects.shift()`), pour que
          // `.limit()` après un `.then()` (ou l'inverse) ne consomme jamais une deuxième entrée.
          let resolu: Promise<unknown[]> | undefined;
          const resoudre = () => {
            resolu ??= Promise.resolve(selects.shift() ?? []);
            return resolu;
          };
          return {
            limit: resoudre,
            orderBy: () => ({ limit: resoudre }),
            then: (onFulfilled: (v: unknown[]) => unknown, onRejected?: (e: unknown) => unknown) =>
              resoudre().then(onFulfilled, onRejected),
            catch: (onRejected: (e: unknown) => unknown) => resoudre().catch(onRejected),
          };
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
        return {
          where: async () => {
            const prochain = suiteUpdateWhere.shift();
            if (prochain) prochain();
          },
        };
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
    poserErreurUpdate: (erreur: unknown) =>
      suiteUpdateWhere.push(() => {
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

/**
 * F-01 (audit sécurité) : capture ce qui est journalisé côté serveur, pour vérifier que la
 * VRAIE erreur y arrive bien (elle ne doit simplement plus fuiter dans la réponse HTTP).
 */
function journalFactice(): ServiceJournal {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as ServiceJournal;
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
    const service = new ServiceClientSousCollections(accesFactice(tx), journalFactice());
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
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const entree: EntreeConditionClient = {
      rabaisMoPourmille: 0,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      valideDuLe: '2026-01-01',
      valideAuLe: null,
    };

    const erreur = await service.creerCondition(CTX, 'c1', entree).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe(
      'periode_chevauchement',
    );
  });

  it(
    'F-01 : une erreur pg brute non reconnue (ni violation de contrainte connue) devient ERREUR_INTERNE SANS le ' +
      'texte du pilote de base en detail, et la vraie erreur est journalisée côté serveur',
    async () => {
      const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
      const erreurBrute = new Error(
        'connection terminated unexpectedly, host=db-primary.internal port=5432',
      );
      fabrique.poserErreurInsert(erreurBrute);
      const journal = journalFactice();
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journal);

      const entree: EntreeConditionClient = {
        rabaisMoPourmille: 0,
        rabaisPiecesPourmille: 0,
        rabaisPneusPourmille: 0,
        valideDuLe: '2026-01-01',
        valideAuLe: null,
      };

      const erreur = (await service.creerCondition(CTX, 'c1', entree).catch((e: unknown) => e)) as {
        code: string;
        status: number;
        detail?: string;
      };

      expect(erreur).toMatchObject({ code: 'ERREUR_INTERNE', status: 500 });
      expect(erreur.detail).toBeUndefined();
      expect(JSON.stringify(erreur)).not.toContain('db-primary.internal');
      expect(journal.error).toHaveBeenCalledWith(
        expect.any(String),
        erreurBrute,
        expect.any(Object),
      );
    },
  );
});

describe('ServiceClientSousCollections — résolution du taux horaire lisible (#72)', () => {
  const conditionRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'cd1',
    tenantId: 'tid-1',
    clientId: 'c1',
    rabaisMoPourmille: 0,
    rabaisPiecesPourmille: 0,
    rabaisPneusPourmille: 0,
    tauxHoraireCode: 'ATELIER',
    delaiPaiementJours: null,
    modePaiement: null,
    plafondCentimes: null,
    valideDu: '2026-01-01',
    valideAu: null,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });

  it('creerCondition : un tauxHoraireCode qui couvre valideDuLe est résolu en libellé + montant', async () => {
    const { tx, poserRetourInsert } = txFactice({
      selects: [[{ id: 'c1' }], [tauxHoraireFixture()]],
    });
    poserRetourInsert([conditionRow()]);
    const service = new ServiceClientSousCollections(accesFactice(tx), journalFactice());
    const entree: EntreeConditionClient = {
      rabaisMoPourmille: 0,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      tauxHoraireCode: 'ATELIER',
      valideDuLe: '2026-01-01',
      valideAuLe: null,
    };

    const enveloppe = await service.creerCondition(CTX, 'c1', entree);

    expect(enveloppe.donnees.tauxHoraireCode).toBe('ATELIER');
    expect(enveloppe.donnees.tauxHoraireLibelle).toBe('Taux horaire atelier');
    expect(enveloppe.donnees.tauxHoraireMontantCentimes).toBe(13_500);
  });

  it("creerCondition : un tauxHoraireCode SANS période de validité couvrant valideDuLe rend libellé/montant null, sans lever d'erreur — cette réponse n'affiche qu'un résultat, jamais le motif d'échec RM-65", async () => {
    const { tx, poserRetourInsert } = txFactice({
      // Le SEUL taux du référentiel démarre après la date de la condition (2026-01-01) : aucune
      // période ne la couvre.
      selects: [[{ id: 'c1' }], [tauxHoraireFixture({ valideDu: '2026-06-01' })]],
    });
    poserRetourInsert([conditionRow()]);
    const service = new ServiceClientSousCollections(accesFactice(tx), journalFactice());
    const entree: EntreeConditionClient = {
      rabaisMoPourmille: 0,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      tauxHoraireCode: 'ATELIER',
      valideDuLe: '2026-01-01',
      valideAuLe: null,
    };

    const enveloppe = await service.creerCondition(CTX, 'c1', entree);

    expect(enveloppe.donnees.tauxHoraireLibelle).toBeNull();
    expect(enveloppe.donnees.tauxHoraireMontantCentimes).toBeNull();
  });

  it('creerCondition : sans tauxHoraireCode (RM-07, taux négocié éventuel), libellé/montant restent null — jamais la cascade de repli RM-65 appliquée ici', async () => {
    const { tx, poserRetourInsert } = txFactice({
      selects: [[{ id: 'c1' }], [tauxHoraireFixture()]],
    });
    poserRetourInsert([conditionRow({ tauxHoraireCode: null })]);
    const service = new ServiceClientSousCollections(accesFactice(tx), journalFactice());
    const entree: EntreeConditionClient = {
      rabaisMoPourmille: 0,
      rabaisPiecesPourmille: 0,
      rabaisPneusPourmille: 0,
      valideDuLe: '2026-01-01',
      valideAuLe: null,
    };

    const enveloppe = await service.creerCondition(CTX, 'c1', entree);

    expect(enveloppe.donnees.tauxHoraireCode).toBeNull();
    expect(enveloppe.donnees.tauxHoraireLibelle).toBeNull();
    expect(enveloppe.donnees.tauxHoraireMontantCentimes).toBeNull();
  });

  it('listerConditions : résout CHAQUE condition à SA PROPRE valideDuLe, avec un SEUL chargement du référentiel taux_horaire pour toute la page (jamais une requête par condition)', async () => {
    const conditionAncienne = conditionRow({
      id: 'cd-ancienne',
      tauxHoraireCode: 'ATELIER',
      valideDu: '2020-01-01',
      creeLeTexte: '2020-01-01 00:00:00+00',
    });
    const conditionRecente = conditionRow({
      id: 'cd-recente',
      tauxHoraireCode: 'ATELIER',
      valideDu: '2026-06-01',
      creeLeTexte: '2026-06-01 00:00:00+00',
    });
    const { tx, whereArgs } = txFactice({
      selects: [
        [{ id: 'c1' }],
        [conditionAncienne, conditionRecente],
        // Deux taux successifs sous le MÊME code : l'ancien couvre 2020-01-01, le nouveau prend le
        // relais au 2026-03-01 — une condition datée de chaque côté de la bascule doit résoudre au
        // taux EN VIGUEUR à SA PROPRE date, pas au dernier taux du référentiel.
        [
          tauxHoraireFixture({
            valideDu: '2020-01-01',
            valideAu: '2026-03-01',
            montantCentimes: 13_500,
          }),
          tauxHoraireFixture({
            id: 'th-2',
            valideDu: '2026-03-01',
            valideAu: null,
            montantCentimes: 14_500,
          }),
        ],
      ],
    });
    const service = new ServiceClientSousCollections(accesFactice(tx), journalFactice());

    const page = await service.listerConditions(CTX, 'c1', { limite: 20 });

    expect(page.donnees.find((c) => c.id === 'cd-ancienne')?.tauxHoraireMontantCentimes).toBe(
      13_500,
    );
    expect(page.donnees.find((c) => c.id === 'cd-recente')?.tauxHoraireMontantCentimes).toBe(
      14_500,
    );
    // 3 `.where()` en tout (client, page de conditions, référentiel taux_horaire) — jamais 4, ce
    // qui prouverait un chargement du référentiel PAR condition affichée.
    expect(whereArgs).toHaveLength(3);
  });
});

describe('ServiceClientSousCollections.creerAdresse — une seule adresse active par type (RM-03)', () => {
  it('une deuxième adresse principale active en même temps est refusée en 400, nommant le type en cause', async () => {
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    fabrique.poserErreurInsert({ code: '23505', constraint: 'client_adresse_principale_uk' });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());
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
    expect((erreur as { erreurs: Array<{ message: string }> }).erreurs[0]?.message).toContain(
      'principale',
    );
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
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

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

  it(
    'F-01 : une erreur pg brute non reconnue sur `creerAdresse` devient ERREUR_INTERNE sans fuite de detail ' +
      '(même garde que creerCondition)',
    async () => {
      const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
      fabrique.poserErreurInsert(
        new Error('duplicate key value violates unique constraint "client_adresse_pkey"'),
      );
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const erreur = (await service
        .creerAdresse(CTX, 'c1', {
          type: 'principale',
          rue: 'Rue Neuve 2',
          complement: null,
          npa: '1200',
          localite: 'Genève',
          pays: 'CH',
        })
        .catch((e: unknown) => e)) as { code: string; detail?: string };

      expect(erreur.code).toBe('ERREUR_INTERNE');
      expect(erreur.detail).toBeUndefined();
    },
  );
});

describe('ServiceClientSousCollections.modifierAdresse/modifierContact — corps vide (F-01, sécurité + RM)', () => {
  it("modifierAdresse : un corps vide ({}) est refusé en 400 VALIDATION_ECHOUEE, AVANT toute écriture ni vérification d'existence du client", async () => {
    const fabrique = txFactice();
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const erreur = await service.modifierAdresse(CTX, 'c1', 'a1', {}).catch((e: unknown) => e);

    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe('corps_vide');
    // Aucune écriture, aucune lecture : le refus intervient avant l'ouverture de la transaction.
    expect(fabrique.updateSetArgs).toHaveLength(0);
    expect(fabrique.whereArgs).toHaveLength(0);
  });

  it('modifierContact : un corps vide ({}) est refusé en 400 VALIDATION_ECHOUEE, même code stable que modifierAdresse', async () => {
    const fabrique = txFactice();
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const erreur = await service.modifierContact(CTX, 'c1', 'ct1', {}).catch((e: unknown) => e);

    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe('corps_vide');
    expect(fabrique.updateSetArgs).toHaveLength(0);
  });

  it('modifierAdresse : un corps portant au moins un champ passe la garde et atteint bien la mise à jour', async () => {
    const fabrique = txFactice({
      selects: [
        [{ id: 'c1' }],
        [
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
        ],
      ],
    });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    await service.modifierAdresse(CTX, 'c1', 'a1', { localite: 'Genève' });

    expect(fabrique.updateSetArgs).toEqual([{ localite: 'Genève' }]);
  });

  it(
    'F-01 : une erreur pg brute non reconnue sur `modifierAdresse` (corps non vide) devient ERREUR_INTERNE sans ' +
      'fuite de detail, et la vraie erreur est journalisée',
    async () => {
      const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
      const erreurBrute = {
        code: '23503',
        constraint: 'client_adresse_fk',
        detail: 'Key (client_id)=(c-fantome) is not present in table "client".',
      };
      fabrique.poserErreurUpdate(erreurBrute);
      const journal = journalFactice();
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journal);

      const erreur = (await service
        .modifierAdresse(CTX, 'c1', 'a1', { localite: 'Genève' })
        .catch((e: unknown) => e)) as {
        code: string;
        status: number;
        detail?: string;
      };

      expect(erreur).toMatchObject({ code: 'ERREUR_INTERNE', status: 500 });
      expect(erreur.detail).toBeUndefined();
      expect(JSON.stringify(erreur)).not.toContain('client_adresse_fk');
      expect(JSON.stringify(erreur)).not.toContain('c-fantome');
      expect(journal.error).toHaveBeenCalledWith(
        expect.any(String),
        erreurBrute,
        expect.any(Object),
      );
    },
  );
});

/**
 * `modifierAdresse` — trou NPA×pays en modification partielle : le schéma zod
 * (`schemaModificationAdresseClient`) ne voit que le corps de la requête, jamais la ligne
 * existante en base. Ces tests prouvent que le SERVICE, lui, regarde l'état EFFECTIF (base +
 * corps fusionnés) — pas seulement les champs envoyés dans CETTE requête.
 */
describe('ServiceClientSousCollections.modifierAdresse — NPA×pays sur l’état EFFECTIF (trou de validation partielle fermé)', () => {
  function adresseExistante(champs: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'a1',
      tenantId: 'tid-1',
      clientId: 'c1',
      type: 'principale' as const,
      rue: 'Rue Neuve 2',
      complement: null,
      npa: '1200',
      localite: 'Genève',
      pays: 'CH',
      actif: true,
      creeLe: new Date('2026-01-01T00:00:00.000Z'),
      modifieLe: new Date('2026-01-01T00:00:00.000Z'),
      ...champs,
    };
  }

  it('PATCH { npa } seul, invalide, sur une adresse CH existante est refusé en 400 VALIDATION_ECHOUEE (champ npa), avant toute écriture', async () => {
    const fabrique = txFactice({
      selects: [[{ id: 'c1' }], [adresseExistante({ npa: '1200', pays: 'CH' })]],
    });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const erreur = await service
      .modifierAdresse(CTX, 'c1', 'a1', { npa: 'ABCDE' })
      .catch((e: unknown) => e);

    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect(
      (erreur as { erreurs: Array<{ champ: string; code: string }> }).erreurs[0],
    ).toMatchObject({ champ: 'npa', code: 'custom' });
    expect(fabrique.updateSetArgs).toHaveLength(0);
  });

  it('PATCH { npa } seul, valide, sur une adresse CH existante est accepté', async () => {
    const fabrique = txFactice({
      selects: [
        [{ id: 'c1' }],
        [adresseExistante({ npa: '1200', pays: 'CH' })],
        [adresseExistante({ npa: '1950', pays: 'CH' })],
      ],
    });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const enveloppe = await service.modifierAdresse(CTX, 'c1', 'a1', { npa: '1950' });

    expect(enveloppe.donnees.npa).toBe('1950');
    expect(fabrique.updateSetArgs).toEqual([{ npa: '1950' }]);
  });

  it('PATCH { pays: "DE", npa: "75001" } simultanés sur une adresse jusque-là CH est accepté (pays étranger, pas de contrainte de format stricte)', async () => {
    const fabrique = txFactice({
      selects: [
        [{ id: 'c1' }],
        [adresseExistante({ npa: '1200', pays: 'CH' })],
        [adresseExistante({ npa: '75001', pays: 'DE' })],
      ],
    });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const enveloppe = await service.modifierAdresse(CTX, 'c1', 'a1', {
      pays: 'DE',
      npa: '75001',
    });

    expect(enveloppe.donnees.pays).toBe('DE');
    expect(enveloppe.donnees.npa).toBe('75001');
  });

  it('PATCH { pays: "CH" } seul sur une adresse jusque-là étrangère dont le NPA EN BASE ne fait pas 4 chiffres est refusé (preuve que le NPA vient de la base, pas du corps)', async () => {
    const fabrique = txFactice({
      selects: [[{ id: 'c1' }], [adresseExistante({ npa: '75001', pays: 'DE' })]],
    });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const erreur = await service
      .modifierAdresse(CTX, 'c1', 'a1', { pays: 'CH' })
      .catch((e: unknown) => e);

    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ champ: string }> }).erreurs[0]).toMatchObject({
      champ: 'npa',
    });
    expect(fabrique.updateSetArgs).toHaveLength(0);
  });

  it('une adresse étrangère modifiée sans toucher npa/pays ne déclenche aucune lecture supplémentaire et n’est jamais faussement refusée', async () => {
    const fabrique = txFactice({
      selects: [
        [{ id: 'c1' }],
        [adresseExistante({ npa: '75001', pays: 'DE', localite: 'Berlin' })],
      ],
    });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const enveloppe = await service.modifierAdresse(CTX, 'c1', 'a1', { localite: 'Berlin' });

    expect(enveloppe.donnees.localite).toBe('Berlin');
    // Deux lectures seulement (existence client + relecture finale) : aucune lecture
    // supplémentaire de l'adresse existante n'a été faite, puisque ni npa ni pays n'est touché.
    expect(fabrique.updateSetArgs).toEqual([{ localite: 'Berlin' }]);
  });

  /**
   * F-01-bis (constaté en reproduction du 10.08 du finding F-01 de l'audit du 28.07, RESSAISI ici
   * : `schemaModificationAdresseClient` porte `pays: schemaCodePays.default('CH')` — hérité de
   * `schemaAdresseClientBase` — que `.partial()` rend OPTIONNEL sans annuler le `.default(...)`.
   * Un corps qui ne mentionne jamais `pays` ressortait donc du `parse` zod avec `pays: 'CH'` posé
   * malgré tout, écrit tel quel en base. Preuve en exécution réelle (avant correctif) : un
   * `PATCH { localite: … }` sur une adresse autrichienne (NPA à 4 chiffres, homographe du format
   * suisse — ex. `1010` Wien) faisait basculer silencieusement `pays` à `CH`, `200`, aucune erreur
   * ni avertissement. `neGarderQueChampsEnvoyes` (service) filtre désormais l'objet zod-parsé sur
   * les clés réellement présentes dans le corps brut avant tout usage — ces deux tests le prouvent.
   */
  it(
    'PATCH { localite } seul sur une adresse AT au NPA homographe suisse (1010) ne réécrit PAS ' +
      '`pays` — ni dans la lecture de l’état effectif, ni dans l’écriture (défaut corrigé)',
    async () => {
      const fabrique = txFactice({
        selects: [
          [{ id: 'c1' }],
          [adresseExistante({ npa: '1010', pays: 'AT', localite: 'Linz-Zentrum' })],
        ],
      });
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const enveloppe = await service.modifierAdresse(CTX, 'c1', 'a1', {
        localite: 'Linz-Zentrum',
      });

      expect(enveloppe.donnees.pays).toBe('AT');
      // Aucune lecture de l'existant ni écriture de `pays` : `entree` ne doit porter QUE
      // `localite`, jamais le `pays: 'CH'` fantôme posé par le `.default(...)` du schéma.
      expect(fabrique.updateSetArgs).toEqual([{ localite: 'Linz-Zentrum' }]);
    },
  );

  it(
    'PATCH {} sur une adresse AT au NPA homographe suisse (1010) est refusé en 400 corps_vide, ' +
      'jamais un no-op qui basculerait `pays` en CH',
    async () => {
      const fabrique = txFactice({
        selects: [[{ id: 'c1' }], [adresseExistante({ npa: '1010', pays: 'AT' })]],
      });
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const erreur = await service.modifierAdresse(CTX, 'c1', 'a1', {}).catch((e: unknown) => e);

      expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
      expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe('corps_vide');
      expect(fabrique.updateSetArgs).toHaveLength(0);
    },
  );

  it(
    'modifierAdresse : un corps qui ne porte QUE des clés inconnues (avec `.strict()`, ' +
      "refusées plutôt qu'élaguées) est refusé en 400 unrecognized_keys, jamais un no-op silencieux",
    async () => {
      const fabrique = txFactice();
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const erreur = await service
        .modifierAdresse(CTX, 'c1', 'a1', { champInconnu: 'x' })
        .catch((e: unknown) => e);

      expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
      expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe(
        'unrecognized_keys',
      );
      expect(fabrique.updateSetArgs).toHaveLength(0);
      expect(fabrique.whereArgs).toHaveLength(0);
    },
  );

  it(
    'modifierContact : un corps qui ne porte QUE des clés inconnues est refusé en 400 unrecognized_keys, ' +
      'même garde que modifierAdresse',
    async () => {
      const fabrique = txFactice();
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const erreur = await service
        .modifierContact(CTX, 'c1', 'ct1', { champInconnu: 'x' })
        .catch((e: unknown) => e);

      expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
      expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe(
        'unrecognized_keys',
      );
      expect(fabrique.updateSetArgs).toHaveLength(0);
    },
  );
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
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());
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

describe('ServiceClientSousCollections — estViolation déballe `.cause` (DÉFAUT 1, erreurs enveloppées par Drizzle)', () => {
  it(
    'creerAdresse : une violation 23505 enveloppée façon `DrizzleQueryError` (`code`/`constraint` ' +
      'SOUS `.cause`, jamais au premier niveau — comportement réel de Drizzle) est reconnue et rend ' +
      '400 VALIDATION_ECHOUEE (RM-03) — jamais 500',
    async () => {
      const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
      // Reproduit l'enveloppe réelle de Drizzle (`pg-core/session.js` :
      // `catch (e) { throw new DrizzleQueryError(query, params, e) }`) : `code`/`constraint`
      // n'existent QUE sous `.cause`, jamais en surface de l'erreur attrapée par le service.
      class FausseDrizzleQueryError extends Error {
        constructor(override readonly cause: unknown) {
          super('Failed query: insert into "client_adresse" ...');
        }
      }
      fabrique.poserErreurInsert(
        new FausseDrizzleQueryError({ code: '23505', constraint: 'client_adresse_principale_uk' }),
      );
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const erreur = await service
        .creerAdresse(CTX, 'c1', {
          type: 'principale',
          rue: 'Rue Neuve 2',
          complement: null,
          npa: '1200',
          localite: 'Genève',
          pays: 'CH',
        })
        .catch((e: unknown) => e);

      expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
      expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe(
        'adresse_active_unique',
      );
    },
  );

  it(
    'creerCondition : une violation 23P01 enveloppée façon `DrizzleQueryError` est reconnue et rend ' +
      '400 VALIDATION_ECHOUEE (RM-07/CT-03) — jamais 500',
    async () => {
      const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
      fabrique.poserErreurInsert({
        message: 'Failed query: insert into "client_condition" ...',
        cause: { code: '23P01', constraint: 'client_condition_periode_excl' },
      });
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const entree: EntreeConditionClient = {
        rabaisMoPourmille: 0,
        rabaisPiecesPourmille: 0,
        rabaisPneusPourmille: 0,
        valideDuLe: '2026-01-01',
        valideAuLe: null,
      };
      const erreur = await service.creerCondition(CTX, 'c1', entree).catch((e: unknown) => e);

      expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
      expect((erreur as { erreurs: Array<{ code: string }> }).erreurs[0]?.code).toBe(
        'periode_chevauchement',
      );
    },
  );

  it(
    'une contrainte HOMONYME (même SQLSTATE 23505) mais un nom DIFFÉRENT — même enveloppée dans ' +
      "`.cause` — n'est PAS reconnue comme la violation RM-03 : elle retombe sur ERREUR_INTERNE, " +
      'jamais faussement traduite, et la vraie erreur reste journalisée',
    async () => {
      const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
      const erreurBrute = {
        message: 'Failed query: insert into "client_adresse" ...',
        // Même SQLSTATE que RM-03, mais une contrainte SANS rapport (clé primaire) : ne doit
        // jamais être confondue avec `client_adresse_principale_uk`/`client_adresse_facturation_uk`.
        cause: { code: '23505', constraint: 'client_adresse_pkey' },
      };
      fabrique.poserErreurInsert(erreurBrute);
      const journal = journalFactice();
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journal);

      const erreur = await service
        .creerAdresse(CTX, 'c1', {
          type: 'principale',
          rue: 'Rue Neuve 2',
          complement: null,
          npa: '1200',
          localite: 'Genève',
          pays: 'CH',
        })
        .catch((e: unknown) => e);

      expect(erreur).toMatchObject({ code: 'ERREUR_INTERNE', status: 500 });
      expect(journal.error).toHaveBeenCalledWith(
        expect.any(String),
        erreurBrute,
        expect.any(Object),
      );
    },
  );
});

describe('ServiceClientSousCollections — curseur de pagination v2 microseconde (DÉFAUT 2)', () => {
  const ADRESSE_BASE = {
    tenantId: 'tid-1',
    clientId: 'c1',
    type: 'principale' as const,
    rue: 'Rue Neuve 2',
    complement: null,
    npa: '1200',
    localite: 'Genève',
    pays: 'CH',
    actif: true,
  };

  it(
    'deux adresses créées dans la MÊME MILLISECONDE (insertion en lot) produisent des curseurs ' +
      "suivants DISTINCTS — l'ancien format v1 (`encoderCurseur`, `Date.toISOString()`) les aurait " +
      'confondues et aurait fait sauter silencieusement la ligne suivante à la page suivante',
    async () => {
      // `creeLe` (Date) IDENTIQUE pour les trois lignes une fois tronqué à la milliseconde par
      // `Date` — exactement le scénario qui déclenchait le défaut. `creeLeTexte` (texte natif
      // PostgreSQL, `::text` sur la colonne) porte lui la microseconde RÉELLE, distincte pour
      // chacune.
      const creeLeCommun = new Date('2026-08-04T10:00:00.171Z');
      const ligneA = {
        ...ADRESSE_BASE,
        id: 'a1',
        creeLe: creeLeCommun,
        creeLeTexte: '2026-08-04 10:00:00.171181+00',
      };
      const ligneB = {
        ...ADRESSE_BASE,
        id: 'a2',
        creeLe: creeLeCommun,
        creeLeTexte: '2026-08-04 10:00:00.171182+00',
      };
      const ligneC = {
        ...ADRESSE_BASE,
        id: 'a3',
        creeLe: creeLeCommun,
        creeLeTexte: '2026-08-04 10:00:00.171183+00',
      };
      expect(ligneA.creeLe.toISOString()).toBe(ligneB.creeLe.toISOString());
      expect(ligneB.creeLe.toISOString()).toBe(ligneC.creeLe.toISOString());

      const fabrique = txFactice({ selects: [[{ id: 'c1' }], [ligneA, ligneB, ligneC]] });
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      const page = await service.listerAdresses(CTX, 'c1', { limite: 2 });

      expect(page.donnees).toHaveLength(2);
      expect(page.curseurSuivant).not.toBeNull();

      const decoderV2 = (curseur: string): { t: string; v: string; i: string } =>
        JSON.parse(Buffer.from(curseur, 'base64url').toString('utf8')) as {
          t: string;
          v: string;
          i: string;
        };
      const decode = decoderV2(page.curseurSuivant!);

      // Le curseur porte bien la ligne B (dernière de la page rendue), avec sa microseconde
      // COMPLÈTE (6 chiffres, décalage explicite) — jamais tronquée à 3 chiffres par un aller-retour
      // `Date`.
      expect(decode.i).toBe('a2');
      expect(decode.v).toBe('2026-08-04T10:00:00.171182+00:00');

      // Preuve directe que B et C restent DISTINGUABLES par le nouveau curseur, alors que
      // `creeLe.toISOString()` (ancien mécanisme) les aurait rendues indiscernables.
      expect(decode.v).not.toBe('2026-08-04T10:00:00.171183+00:00');
    },
  );

  it(
    'un curseur v1 historique (format `{c,i}` émis par `encoderCurseur` avant ce correctif) reste ' +
      'décodable indéfiniment — jamais un 500, aucune régression pour les curseurs déjà en circulation',
    async () => {
      // `i` doit être un UUID valide (`decoderCurseur`/`decoderCurseurTrie` le valident par regex,
      // comme un vrai id de ligne le serait toujours en production).
      const curseurV1 = Buffer.from(
        JSON.stringify({
          c: '2026-08-04T10:00:00.171Z',
          i: '00000000-0000-0000-0000-000000000001',
        }),
        'utf8',
      ).toString('base64url');

      const fabrique = txFactice({ selects: [[{ id: 'c1' }], []] });
      const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

      await expect(
        service.listerAdresses(CTX, 'c1', { limite: 2, curseur: curseurV1 }),
      ).resolves.toMatchObject({ donnees: [], curseurSuivant: null });
    },
  );

  it('un curseur illisible (JSON invalide une fois décodé) est un 400 VALIDATION_ECHOUEE, jamais un 500', async () => {
    const curseurCasse = Buffer.from('ceci nest pas du json', 'utf8').toString('base64url');
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    const erreur = await service
      .listerAdresses(CTX, 'c1', { limite: 2, curseur: curseurCasse })
      .catch((e: unknown) => e);

    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });
});

describe('ServiceClientSousCollections — isolation tenant sur les sous-collections', () => {
  it("un clientId qui n'existe pas pour le tenant du contexte est 404 RESSOURCE_INTROUVABLE, sur toute sous-collection", async () => {
    const fabrique = txFactice({ selects: [[]] });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    await expect(service.listerAdresses(CTX, 'c-autre-tenant', PAGE)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it("la vérification d'existence du client filtre sur le tenantId du CONTEXTE, en plus de son id", async () => {
    const fabrique = txFactice({ selects: [[{ id: 'c1' }]] });
    const service = new ServiceClientSousCollections(accesFactice(fabrique.tx), journalFactice());

    await service.listerAdresses(CTX, 'c1', PAGE);

    // Deux lectures : la vérification d'existence du client, puis la liste paginée des adresses —
    // la PREMIÈRE est celle de la vérification d'existence, elle aussi scopée au tenant.
    expect(fabrique.whereArgs.length).toBeGreaterThanOrEqual(1);
    const { sql: texte, params } = dialect.sqlToQuery(fabrique.whereArgs[0] as SQL);
    expect(texte).toContain('tenant_id');
    expect(params).toContain('tid-1');
  });
});
