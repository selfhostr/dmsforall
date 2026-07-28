import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { EntreeCreationClient, EntreeDesactivationClient } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { Horloge } from '../common/horloge';
import type { ReponseMemorisable, RequeteIdempotente, ResultatIdempotent, ServiceIdempotence } from '../common/idempotence';
import type { ServiceCompteurs } from '../parametrage/compteurs/compteurs.types';
import type { LigneClient } from '../db/schema';
import { ServiceClient } from './service-client';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const dialect = new PgDialect();

function ligneClient(champs: Partial<LigneClient> = {}): LigneClient {
  return {
    id: 'c1',
    tenantId: 'tid-1',
    numero: 'CL-000007',
    type: 'particulier',
    civilite: null,
    nom: 'Dupont',
    prenom: 'Jean',
    raisonSociale: null,
    ide: null,
    langue: 'fr',
    email: null,
    telephone: null,
    telephoneE164: null,
    canalPrefere: null,
    statut: 'actif',
    poObligatoire: false,
    groupeClientId: null,
    fusionneVersClientId: null,
    referenceExterne: null,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-01-01T00:00:00.000Z'),
    ...champs,
  } as LigneClient;
}

/**
 * Fausse transaction générique : `select().from().where().limit()` rend, DANS L'ORDRE, les jeux
 * fournis par `selects` ; `execute()` rend, dans l'ordre, les jeux fournis par `executes` ;
 * `insert().values()` est directement awaitable (insert sans `.returning()`) ET expose
 * `.returning()` pour les insert qui l'utilisent. Les arguments passés à `.where()`, `.set()` et
 * `.values()` sont capturés pour vérifier le scope tenant et le contenu écrit.
 */
function txFactice(plan: { selects?: readonly unknown[][]; executes?: ReadonlyArray<{ rows: readonly unknown[] }> } = {}) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const insertsReturning: unknown[][] = [];
  const whereArgs: unknown[] = [];
  const setArgs: unknown[] = [];
  const insertValuesArgs: Array<Record<string, unknown>> = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereArgs.push(cond);
          return { limit: () => Promise.resolve(selects.shift() ?? []) };
        },
      }),
    }),
    update: () => ({
      set: (vals: unknown) => {
        setArgs.push(vals);
        return {
          where: (cond: unknown) => {
            whereArgs.push(cond);
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return {
          returning: () => Promise.resolve(insertsReturning.shift() ?? []),
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
    }),
    execute: vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] })),
  };

  return { tx: tx as unknown as TransactionDfa, whereArgs, setArgs, insertValuesArgs, poserRetourInsert: (lignes: unknown[]) => insertsReturning.push(lignes) };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

function idempotenceFactice(tx: TransactionDfa): ServiceIdempotence {
  return {
    async executer<T extends ReponseMemorisable>(
      _ctx: ContexteTenant,
      _requete: RequeteIdempotente,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<ResultatIdempotent<T>> {
      const reponse = await travail(tx);
      return { reponse, rejoue: false };
    },
  };
}

function compteursFactice(numero: number): ServiceCompteurs {
  return { prochainNumero: vi.fn().mockResolvedValue(numero) };
}

const ENTREE_MINIMALE: EntreeCreationClient = {
  type: 'particulier',
  civilite: null,
  nom: 'Dupont',
  prenom: 'Jean',
  raisonSociale: null,
  ide: null,
  langueCorrespondance: 'fr',
  adressePrincipale: { rue: 'Rue du Lac 1', complement: null, npa: '1000', localite: 'Lausanne', pays: 'CH' },
  telephones: [],
  email: null,
  poObligatoire: false,
  groupeId: null,
  referenceExterne: null,
};

describe("ServiceClient.modifier — le type d'un client ne peut plus changer après création (RM-01)", () => {
  it('un corps contenant la clé "type" est refusé (409 CLIENT_TYPE_IMMUABLE), sans toucher la base', async () => {
    const { tx } = txFactice();
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    await expect(service.modifier(CTX, 'c1', { type: 'entreprise' })).rejects.toMatchObject({
      code: 'CLIENT_TYPE_IMMUABLE',
      status: 409,
    });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('la présence de "type" est refusée même si la valeur envoyée est identique au type actuel (le garde ne compare rien, il refuse la présence)', async () => {
    const { tx } = txFactice();
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    await expect(service.modifier(CTX, 'c1', { type: 'particulier' })).rejects.toMatchObject({
      code: 'CLIENT_TYPE_IMMUABLE',
    });
  });

  it('un corps sans "type" est accepté et met à jour les champs demandés', async () => {
    // Deux lectures : la vérification d'existence avant écriture, puis la relecture après UPDATE.
    const { tx, setArgs } = txFactice({ selects: [[ligneClient()], [ligneClient({ nom: 'Nouveau-Nom' })]] });
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    const enveloppe = await service.modifier(CTX, 'c1', { nom: 'Nouveau-Nom' });

    expect(enveloppe.donnees.nom).toBe('Nouveau-Nom');
    expect(setArgs).toHaveLength(1);
    expect(setArgs[0]).not.toHaveProperty('type');
  });
});

describe('ServiceClient.desactiver — refus tant que des OR ou détentions restent ouverts (RM-12)', () => {
  it('refuse quand un ordre de réparation non terminal existe encore, en le nommant dans blocages[]', async () => {
    const { tx, setArgs } = txFactice({
      selects: [[ligneClient()], [{ id: 'or1', numero: 'OR-000042' }], []],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());
    const entree: EntreeDesactivationClient = { motif: 'Client parti à la concurrence' };

    const erreur = await service.desactiver(CTX, 'c1', entree).catch((e: unknown) => e);
    expect(erreur).toMatchObject({ code: 'CLIENT_DESACTIVATION_IMPOSSIBLE', status: 409 });
    expect((erreur as { blocages: Array<{ type: string; id: string }> }).blocages).toEqual([
      { type: 'ordre_reparation', id: 'or1', libelle: 'Ordre de réparation OR-000042' },
    ]);
    // Le refus intervient AVANT toute écriture.
    expect(setArgs).toHaveLength(0);
  });

  it('refuse quand une détention de véhicule est encore ouverte', async () => {
    const { tx, setArgs } = txFactice({
      selects: [[ligneClient()], [], [{ id: 'd1' }]],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    await expect(service.desactiver(CTX, 'c1', { motif: 'Véhicule vendu' })).rejects.toMatchObject({
      code: 'CLIENT_DESACTIVATION_IMPOSSIBLE',
    });
    expect(setArgs).toHaveLength(0);
  });

  it("autorise la désactivation quand plus aucun OR ni détention n'est ouvert, et journalise le motif", async () => {
    const { tx, setArgs, insertValuesArgs } = txFactice({
      selects: [[ligneClient()], [], [], [ligneClient({ statut: 'inactif' })]],
      executes: [{ rows: [{ dernier: null }] }],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    const enveloppe = await service.desactiver(CTX, 'c1', { motif: 'Client parti à la concurrence' });

    expect(enveloppe.donnees.statut).toBe('inactif');
    expect(setArgs).toEqual([{ statut: 'inactif' }]);
    const insertNote = insertValuesArgs.find((appel) => 'texte' in appel);
    expect(insertNote?.texte).toContain('Client parti à la concurrence');
  });
});

describe("ServiceClient.creer — un doublon probable est un avertissement, jamais un refus (RM-05, CT-01)", () => {
  it("la création réussit malgré un doublon détecté, et le signale dans avertissements[] sans bloquer", async () => {
    const { tx, poserRetourInsert } = txFactice({
      executes: [{ rows: [{ client_id: 'c-existant', numero: 'CL-000001', nom: 'Dupont Jean', npa: '1000' }] }],
    });
    poserRetourInsert([ligneClient()]);
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(7), new Horloge());

    const resultat = await service.creer(CTX, ENTREE_MINIMALE, 'idem-key-1');

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(resultat.reponse.corps.avertissements).toEqual([
      expect.objectContaining({ code: 'CLIENT_DOUBLON_PROBABLE' }),
    ]);
  });

  it('aucun doublon détecté : la création réussit sans avertissement', async () => {
    const { tx, poserRetourInsert } = txFactice({ executes: [{ rows: [] }] });
    poserRetourInsert([ligneClient()]);
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(7), new Horloge());

    const resultat = await service.creer(CTX, ENTREE_MINIMALE, 'idem-key-2');

    expect(resultat.reponse.corps.avertissements).toEqual([]);
  });

  it('le client créé porte le tenant du contexte et le numéro formaté depuis le compteur, jamais un tenant fourni par ailleurs', async () => {
    const { tx, poserRetourInsert, insertValuesArgs } = txFactice({ executes: [{ rows: [] }] });
    poserRetourInsert([ligneClient()]);
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(7), new Horloge());

    await service.creer(CTX, ENTREE_MINIMALE, 'idem-key-3');

    const insertClient = insertValuesArgs.find((appel) => 'type' in appel);
    expect(insertClient).toMatchObject({ tenantId: 'tid-1', numero: 'CL-000007', type: 'particulier' });
  });
});

describe('ServiceClient — isolation tenant : le tenant du contexte est explicitement filtré (le RLS est le filet, pas le mécanisme)', () => {
  it('parId() : un client absent du tenant courant est 404 RESSOURCE_INTROUVABLE, jamais 403', async () => {
    const { tx } = txFactice({ selects: [[]] });
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    await expect(service.parId(CTX, 'c-autre-tenant')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('parId() : la condition de sélection porte le tenantId du CONTEXTE, en plus de son id', async () => {
    const { tx, whereArgs } = txFactice({ selects: [[ligneClient()]], executes: [{ rows: [{ dernier: null }] }] });
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    await service.parId(CTX, 'c1');

    expect(whereArgs).toHaveLength(1);
    const { sql: texte, params } = dialect.sqlToQuery(whereArgs[0] as SQL);
    expect(texte).toContain('tenant_id');
    expect(params).toContain('tid-1');
  });

  it("lister() filtre explicitement sur le tenantId du contexte dans la requête exécutée", async () => {
    const { tx } = txFactice({ executes: [{ rows: [] }] });
    const acces = accesFactice(tx);
    const service = new ServiceClient(acces, idempotenceFactice(tx), compteursFactice(1), new Horloge());

    await service.lister(CTX, { tri: 'nom:asc', limite: 20 });

    const appel = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SQL;
    const { sql: texte, params } = dialect.sqlToQuery(appel);
    expect(texte).toContain('c.tenant_id');
    expect(params).toContain('tid-1');
  });
});
