import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { EntreeCreationClient, EntreeDesactivationClient } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { Horloge } from '../common/horloge';
import { decoderCurseurTrie } from '../common/pagination';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
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
function txFactice(
  plan: {
    selects?: readonly unknown[][];
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
  } = {},
) {
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

  return {
    tx: tx as unknown as TransactionDfa,
    whereArgs,
    setArgs,
    insertValuesArgs,
    poserRetourInsert: (lignes: unknown[]) => insertsReturning.push(lignes),
  };
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
  adressePrincipale: {
    rue: 'Rue du Lac 1',
    complement: null,
    npa: '1000',
    localite: 'Lausanne',
    pays: 'CH',
  },
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
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    await expect(service.modifier(CTX, 'c1', { type: 'entreprise' })).rejects.toMatchObject({
      code: 'CLIENT_TYPE_IMMUABLE',
      status: 409,
    });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('la présence de "type" est refusée même si la valeur envoyée est identique au type actuel (le garde ne compare rien, il refuse la présence)', async () => {
    const { tx } = txFactice();
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    await expect(service.modifier(CTX, 'c1', { type: 'particulier' })).rejects.toMatchObject({
      code: 'CLIENT_TYPE_IMMUABLE',
    });
  });

  it('un corps sans "type" est accepté et met à jour les champs demandés', async () => {
    // Deux lectures : la vérification d'existence avant écriture, puis la relecture après UPDATE.
    const { tx, setArgs } = txFactice({
      selects: [[ligneClient()], [ligneClient({ nom: 'Nouveau-Nom' })]],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    const enveloppe = await service.modifier(CTX, 'c1', { nom: 'Nouveau-Nom' });

    expect(enveloppe.donnees.nom).toBe('Nouveau-Nom');
    expect(setArgs).toHaveLength(1);
    expect(setArgs[0]).not.toHaveProperty('type');
  });
});

/**
 * Frère du trou NPA×pays (adresses) : une règle qui dépend de DEUX champs (`type` × `nom`/
 * `raisonSociale`), contournable en `PATCH` si un seul des deux est envoyé. `type` reste
 * IMMUABLE (RM-01, non touché ici) — c'est `nom`/`raisonSociale` qui doit être revalidé contre le
 * `type` DÉJÀ EN BASE, jamais un `type` du corps (qui est de toute façon interdit en PATCH). Le
 * CHECK `client_identite_chk` (migration 0006) garantit déjà l'intégrité en base : ce correctif
 * transforme une erreur pg brute en `400 VALIDATION_ECHOUEE` propre, il ne comble pas un trou
 * d'intégrité (contrairement au cas NPA, qui n'avait aucun filet DB).
 */
describe('ServiceClient.modifier — nom/raisonSociale revalidés contre le type EN BASE (client_identite_chk, frère du trou NPA×pays)', () => {
  it('PATCH { nom: null } sur un client particulier est refusé en 400 VALIDATION_ECHOUEE (champ nom), avant toute écriture', async () => {
    const { tx, setArgs } = txFactice({
      selects: [[ligneClient({ type: 'particulier', nom: 'Dupont' })]],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    const erreur = await service.modifier(CTX, 'c1', { nom: null }).catch((e: unknown) => e);

    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ champ: string }> }).erreurs[0]).toMatchObject({
      champ: 'nom',
    });
    expect(setArgs).toHaveLength(0);
  });

  it('PATCH { raisonSociale: null } sur un client entreprise est refusé en 400 VALIDATION_ECHOUEE (champ raisonSociale), avant toute écriture', async () => {
    const { tx, setArgs } = txFactice({
      selects: [
        [ligneClient({ type: 'entreprise', nom: null, raisonSociale: 'Garage Martin SA' })],
      ],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    const erreur = await service
      .modifier(CTX, 'c1', { raisonSociale: null })
      .catch((e: unknown) => e);

    expect(erreur).toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
    expect((erreur as { erreurs: Array<{ champ: string }> }).erreurs[0]).toMatchObject({
      champ: 'raisonSociale',
    });
    expect(setArgs).toHaveLength(0);
  });

  it("un PATCH qui ne touche ni nom ni raisonSociale sur un client entreprise (dont le nom en base est déjà null) n'est jamais faussement refusé", async () => {
    const { tx, setArgs } = txFactice({
      selects: [
        [ligneClient({ type: 'entreprise', nom: null, raisonSociale: 'Garage Martin SA' })],
        [ligneClient({ type: 'entreprise', nom: null, raisonSociale: 'Garage Martin SA' })],
      ],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    const enveloppe = await service.modifier(CTX, 'c1', { email: 'contact@garage-martin.ch' });

    expect(enveloppe.donnees.raisonSociale).toBe('Garage Martin SA');
    expect(setArgs).toEqual([{ email: 'contact@garage-martin.ch' }]);
  });
});

describe('ServiceClient.desactiver — refus tant que des OR ou détentions restent ouverts (RM-12)', () => {
  it('refuse quand un ordre de réparation non terminal existe encore, en le nommant dans blocages[]', async () => {
    const { tx, setArgs } = txFactice({
      selects: [[ligneClient()], [{ id: 'or1', numero: 'OR-000042' }], []],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );
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
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

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
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    const enveloppe = await service.desactiver(CTX, 'c1', {
      motif: 'Client parti à la concurrence',
    });

    expect(enveloppe.donnees.statut).toBe('inactif');
    expect(setArgs).toEqual([{ statut: 'inactif' }]);
    const insertNote = insertValuesArgs.find((appel) => 'texte' in appel);
    expect(insertNote?.texte).toContain('Client parti à la concurrence');
  });
});

describe('ServiceClient.creer — un doublon probable est un avertissement, jamais un refus (RM-05, CT-01)', () => {
  it('la création réussit malgré un doublon détecté, et le signale dans avertissements[] sans bloquer', async () => {
    const { tx, poserRetourInsert } = txFactice({
      executes: [
        {
          rows: [{ client_id: 'c-existant', numero: 'CL-000001', nom: 'Dupont Jean', npa: '1000' }],
        },
      ],
    });
    poserRetourInsert([ligneClient()]);
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(7),
      new Horloge(),
    );

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
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(7),
      new Horloge(),
    );

    const resultat = await service.creer(CTX, ENTREE_MINIMALE, 'idem-key-2');

    expect(resultat.reponse.corps.avertissements).toEqual([]);
  });

  it('le client créé porte le tenant du contexte et le numéro formaté depuis le compteur, jamais un tenant fourni par ailleurs', async () => {
    const { tx, poserRetourInsert, insertValuesArgs } = txFactice({ executes: [{ rows: [] }] });
    poserRetourInsert([ligneClient()]);
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(7),
      new Horloge(),
    );

    await service.creer(CTX, ENTREE_MINIMALE, 'idem-key-3');

    const insertClient = insertValuesArgs.find((appel) => 'type' in appel);
    expect(insertClient).toMatchObject({
      tenantId: 'tid-1',
      numero: 'CL-000007',
      type: 'particulier',
    });
  });
});

describe('ServiceClient — isolation tenant : le tenant du contexte est explicitement filtré (le RLS est le filet, pas le mécanisme)', () => {
  it('parId() : un client absent du tenant courant est 404 RESSOURCE_INTROUVABLE, jamais 403', async () => {
    const { tx } = txFactice({ selects: [[]] });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    await expect(service.parId(CTX, 'c-autre-tenant')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('parId() : la condition de sélection porte le tenantId du CONTEXTE, en plus de son id', async () => {
    const { tx, whereArgs } = txFactice({
      selects: [[ligneClient()]],
      executes: [{ rows: [{ dernier: null }] }],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    await service.parId(CTX, 'c1');

    expect(whereArgs).toHaveLength(1);
    const { sql: texte, params } = dialect.sqlToQuery(whereArgs[0] as SQL);
    expect(texte).toContain('tenant_id');
    expect(params).toContain('tid-1');
  });

  it('lister() filtre explicitement sur le tenantId du contexte dans la requête exécutée', async () => {
    const { tx } = txFactice({ executes: [{ rows: [] }] });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    await service.lister(CTX, { tri: 'nom:asc', limite: 20 });

    const appel = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SQL;
    const { sql: texte, params } = dialect.sqlToQuery(appel);
    expect(texte).toContain('c.tenant_id');
    expect(params).toContain('tid-1');
  });
});

describe(
  "ServiceClient.lister — filtre `q` : la clause téléphone ne doit jamais devenir un `like '%%'` " +
    'qui matche tout client ayant un numéro (régression : `q=ZZZZZNEXISTEPAS` remontait tous les ' +
    'clients avec téléphone renseigné, faute de garde sur un terme sans aucun chiffre)',
  () => {
    it("un terme sans aucun chiffre (recherche par nom pure) n'ajoute pas la clause `telephone_e164 like`, et ne génère jamais le paramètre littéral '%%'", async () => {
      const { tx } = txFactice({ executes: [{ rows: [] }] });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      await service.lister(CTX, { tri: 'nom:asc', limite: 20, q: 'Rochat' });

      const appel = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SQL;
      const { sql: texte, params } = dialect.sqlToQuery(appel);
      // `telephone_e164` apparaît légitimement dans la liste `select` (colonne projetée) : c'est
      // la clause `... like` du `where`, spécifiquement, qui ne doit jamais être générée ici.
      expect(texte).not.toContain('telephone_e164 like');
      expect(params).not.toContain('%%');
      expect(texte).toContain('normaliser_recherche');
    });

    it('un terme purement numérique (fragment de téléphone) ajoute la clause `telephone_e164 like` avec le motif attendu', async () => {
      const { tx } = txFactice({ executes: [{ rows: [] }] });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      await service.lister(CTX, { tri: 'nom:asc', limite: 20, q: '079' });

      const appel = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SQL;
      const { sql: texte, params } = dialect.sqlToQuery(appel);
      expect(texte).toContain('telephone_e164');
      expect(params).toContain('%079%');
    });

    it('un terme mixte (lettres + chiffres) garde la clause téléphone active avec le seul fragment numérique', async () => {
      const { tx } = txFactice({ executes: [{ rows: [] }] });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      await service.lister(CTX, { tri: 'nom:asc', limite: 20, q: 'Rochat 021' });

      const appel = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SQL;
      const { sql: texte, params } = dialect.sqlToQuery(appel);
      expect(texte).toContain('telephone_e164');
      expect(params).toContain('%021%');
    });
  },
);

describe(
  "ServiceClient.lister — tri 'creeLe:desc' : le curseur doit préserver la MICROSECONDE de " +
    "PostgreSQL, jamais la tronquer à la milliseconde d'un `Date` JavaScript (régression : " +
    'plusieurs clients créés en lot, donc partageant la même milliseconde, faisaient sauter des ' +
    'lignes entières de pagination — voir `pagination-triee.ts` et ' +
    '`common/pagination/valeur-temporelle.ts`)',
  () => {
    it('la colonne `triValeur` est sélectionnée avec un cast ::text explicite, jamais laissée au parseur par défaut du pilote', async () => {
      const { tx } = txFactice({ executes: [{ rows: [] }] });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      await service.lister(CTX, { tri: 'creeLe:desc', limite: 20 });

      const appel = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SQL;
      const { sql: texte } = dialect.sqlToQuery(appel);
      expect(texte).toContain('(c.cree_le)::text as "triValeur"');
    });

    it(
      'deux clients partageant EXACTEMENT la même microseconde de création sortent tous les deux, sur deux ' +
        'pages successives, plutôt que de faire sauter la seconde page (le défaut historique)',
      async () => {
        const MEME_INSTANT = '2026-07-29 13:37:35.171181+00';
        const ID_1 = '11111111-1111-4111-8111-111111111111';
        const ID_2 = '22222222-2222-4222-8222-222222222222';
        const { tx } = txFactice({
          executes: [
            {
              rows: [
                {
                  ...ligneClient({ id: ID_1 }),
                  triValeur: MEME_INSTANT,
                  localite: null,
                  nombreVehicules: 0,
                  dernierPassageLe: null,
                },
                {
                  ...ligneClient({ id: ID_2 }),
                  triValeur: MEME_INSTANT,
                  localite: null,
                  nombreVehicules: 0,
                  dernierPassageLe: null,
                },
              ],
            },
          ],
        });
        const acces = accesFactice(tx);
        const service = new ServiceClient(
          acces,
          idempotenceFactice(tx),
          compteursFactice(1),
          new Horloge(),
        );

        const page = await service.lister(CTX, { tri: 'creeLe:desc', limite: 1 });

        expect(page.donnees).toHaveLength(1);
        expect(page.curseurSuivant).not.toBeNull();
        // La régression : `new Date(MEME_INSTANT).toISOString()` tronque `.171181` en `.171`, et la
        // comparaison keyset SQL exclut alors TOUTE ligne à `.171181` (curseur < valeur réelle) —
        // la page 2 revenait vide. Le curseur encodé doit porter la microseconde intacte.
        const decode = decoderCurseurTrie(page.curseurSuivant as string, 'creeLe:desc');
        expect(decode.valeur).toBe('2026-07-29T13:37:35.171181+00:00');
      },
    );
  },
);

describe(
  'ServiceClient.lister — désambiguïsation comptoir (telephone/localite/nombreVehicules/dernierPassageLe) : ' +
    'UNE seule requête, LEFT JOIN, jamais de N+1 ni de client exclu faute d’adresse ou de véhicule',
  () => {
    it('exécute une seule requête (un seul appel execute()) même enrichie des trois LATERAL', async () => {
      const { tx } = txFactice({ executes: [{ rows: [] }] });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      await service.lister(CTX, { tri: 'nom:asc', limite: 20 });

      expect((tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('les trois jointures ajoutées sont des LEFT JOIN LATERAL — un client sans adresse ni véhicule ne doit jamais disparaître de la page', async () => {
      const { tx } = txFactice({ executes: [{ rows: [] }] });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      await service.lister(CTX, { tri: 'nom:asc', limite: 20 });

      const appel = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as SQL;
      const { sql: texte } = dialect.sqlToQuery(appel);
      const occurrencesJoinLateral = (texte.match(/join lateral/g) ?? []).length;
      const occurrencesLeftJoinLateral = (texte.match(/left join lateral/g) ?? []).length;
      // Les 3 LATERAL (adresse, véhicules, dernier passage) sont TOUS des `left join lateral` —
      // si l'un d'eux glissait en `inner join lateral` (ou `join lateral` nu), les deux comptes
      // divergeraient. C'est précisément le piège classique de ce genre d'enrichissement : un
      // client neuf, sans adresse ni véhicule, disparaîtrait silencieusement de la page.
      expect(occurrencesJoinLateral).toBe(3);
      expect(occurrencesLeftJoinLateral).toBe(3);
    });

    it(
      'un client sans adresse principale active et sans détention ouverte ressort bien dans la page, avec ' +
        'localite: null et nombreVehicules: 0 (pas exclu de la liste)',
      async () => {
        const { tx } = txFactice({
          executes: [
            {
              rows: [
                {
                  ...ligneClient({ id: 'c-neuf', numero: 'CL-000099' }),
                  triValeur: 'Nouveau Client',
                  localite: null,
                  nombreVehicules: 0,
                  dernierPassageLe: null,
                },
              ],
            },
          ],
        });
        const acces = accesFactice(tx);
        const service = new ServiceClient(
          acces,
          idempotenceFactice(tx),
          compteursFactice(1),
          new Horloge(),
        );

        const page = await service.lister(CTX, { tri: 'nom:asc', limite: 20 });

        expect(page.donnees).toHaveLength(1);
        expect(page.donnees[0]).toMatchObject({
          id: 'c-neuf',
          localite: null,
          nombreVehicules: 0,
          dernierPassageLe: null,
        });
      },
    );

    it('propage telephone (colonne directe), localite, nombreVehicules et dernierPassageLe pour un client renseigné', async () => {
      const { tx } = txFactice({
        executes: [
          {
            rows: [
              {
                ...ligneClient({ telephone: '021 123 45 67' }),
                triValeur: 'Dupont Jean',
                localite: 'Lausanne',
                nombreVehicules: 2,
                dernierPassageLe: new Date('2026-06-15T00:00:00.000Z'),
              },
            ],
          },
        ],
      });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      const page = await service.lister(CTX, { tri: 'nom:asc', limite: 20 });

      expect(page.donnees[0]).toMatchObject({
        telephone: '021 123 45 67',
        localite: 'Lausanne',
        nombreVehicules: 2,
        dernierPassageLe: '2026-06-15T00:00:00.000Z',
      });
    });

    it(
      'dernierPassageLe rendu EN CHAÎNE (forme défensive gérée par `enDate()`, en plus du `Date` que rend ' +
        'en pratique le pilote pg sur ce SQL brut — voir la doc de `enDate()`) est projeté en ISO sans ' +
        "planter. Régression couverte : c'est exactement cette forme qui faisait planter GET /clients en " +
        '500 (`extra.dernierPassageLe.toISOString is not a function`) sur un client réel avec un OR.',
      async () => {
        const { tx } = txFactice({
          executes: [
            {
              rows: [
                {
                  ...ligneClient({ telephone: '021 123 45 67' }),
                  triValeur: 'Dupont Jean',
                  localite: 'Lausanne',
                  nombreVehicules: 1,
                  dernierPassageLe: '2026-06-15T00:00:00.000Z',
                },
              ],
            },
          ],
        });
        const acces = accesFactice(tx);
        const service = new ServiceClient(
          acces,
          idempotenceFactice(tx),
          compteursFactice(1),
          new Horloge(),
        );

        const page = await service.lister(CTX, { tri: 'nom:asc', limite: 20 });

        expect(page.donnees[0]?.dernierPassageLe).toBe('2026-06-15T00:00:00.000Z');
      },
    );
  },
);

describe("ServiceClient.parId — notesAlerte (RM-13) : uniquement les notes de nature 'alerte', jamais les notes internes", () => {
  it("mappe la note d'alerte renvoyée par la requête, avec son auteur", async () => {
    const { tx } = txFactice({
      selects: [[ligneClient()]],
      executes: [
        { rows: [{ dernier: null }] },
        {
          rows: [
            {
              id: 'n1',
              texte: 'Rappeler avant tout supplément',
              creeLe: new Date('2026-07-01T00:00:00.000Z'),
              auteurId: 'u1',
              auteurPrenom: 'Marie',
              auteurNom: 'Rey',
            },
          ],
        },
      ],
    });
    const acces = accesFactice(tx);
    const service = new ServiceClient(
      acces,
      idempotenceFactice(tx),
      compteursFactice(1),
      new Horloge(),
    );

    const dto = await service.parId(CTX, 'c1');

    expect(dto.notesAlerte).toEqual([
      {
        id: 'n1',
        nature: 'alerte',
        texte: 'Rappeler avant tout supplément',
        auteur: { utilisateurId: 'u1', nomAffiche: 'Marie Rey' },
        creeLe: '2026-07-01T00:00:00.000Z',
      },
    ]);
  });

  it(
    'dernierPassageLe et creeLe (note) rendus EN CHAÎNE (forme défensive gérée par `enDate()`, en plus du ' +
      '`Date` que rendent en pratique les deux requêtes SQL brutes de `parId` — `dernierPassage()` et ' +
      '`chargerNotesAlerte()` — voir la doc de `enDate()`) ' +
      'sont projetés en ISO sans planter, tout comme quand ils sont rendus en `Date`',
    async () => {
      const { tx } = txFactice({
        selects: [[ligneClient()]],
        executes: [
          { rows: [{ dernier: '2026-06-20T07:30:00.000Z' }] },
          {
            rows: [
              {
                id: 'n1',
                texte: 'Rappeler avant tout supplément',
                creeLe: '2026-07-01T00:00:00.000Z',
                auteurId: 'u1',
                auteurPrenom: 'Marie',
                auteurNom: 'Rey',
              },
            ],
          },
        ],
      });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      const dto = await service.parId(CTX, 'c1');

      expect(dto.dernierPassageLe).toBe('2026-06-20T07:30:00.000Z');
      expect(dto.notesAlerte[0]?.creeLe).toBe('2026-07-01T00:00:00.000Z');
    },
  );

  it(
    "la requête de notes exécutée filtre explicitement sur nature = 'alerte' (et le tenant) — " +
      "une note 'interne' (ex. le motif de désactivation) ne peut donc jamais fuiter ici ; " +
      'seul GET /clients/{id}/notes les expose',
    async () => {
      const { tx } = txFactice({
        selects: [[ligneClient()]],
        executes: [{ rows: [{ dernier: null }] }, { rows: [] }],
      });
      const acces = accesFactice(tx);
      const service = new ServiceClient(
        acces,
        idempotenceFactice(tx),
        compteursFactice(1),
        new Horloge(),
      );

      await service.parId(CTX, 'c1');

      // Deuxième appel execute() de parId() : dernierPassage() est le premier, chargerNotesAlerte() le second.
      const appelNotes = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock
        .calls[1]?.[0] as SQL;
      const { sql: texte, params } = dialect.sqlToQuery(appelNotes);
      expect(texte).toContain("nature = 'alerte'");
      expect(texte).not.toContain("nature = 'interne'");
      expect(params).toContain('tid-1');
    },
  );
});
