import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { decoderCurseurTrie } from '../common/pagination';
import type { LigneClient } from '../db/schema';
import { ServiceClientOrdresReparation } from './service-client-ordres-reparation';
import type { ParametresListeOrDuClient } from './schemas';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const dialect = new PgDialect();
const PARAMS_DEFAUT: ParametresListeOrDuClient = { limite: 20, tri: 'ouvertLe:desc' };

function ligneClient(champs: Partial<LigneClient> = {}): LigneClient {
  return {
    id: 'c1',
    tenantId: 'tid-1',
    numero: 'CL-000001',
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
 * `ouvertLe`/`triValeur` EN CHAÎNE par défaut : `enDate()` (utilisé par `versOrdreReparationResume`
 * pour `ouvertLe`/`restitutionPromiseLe`) accepte aussi bien une chaîne qu'un `Date` — mesuré, le
 * pilote pg y rend en fait un `Date` sur ce SQL brut de `ServiceClientOrdresReparation.lister`
 * (`tx.execute`), mais rester défensif ici couvre aussi tout chemin d'exécution qui rendrait un
 * jour une chaîne. Un défaut à `new Date(...)` masquerait toute régression sur
 * `ouvertLe.toISOString()` / `restitutionPromiseLe.toISOString()` dans TOUS les tests de ce fichier
 * qui utilisent ce défaut sans le surcharger — précisément la façon dont le bug identique sur
 * `ServiceClient.lister` (`GET /clients` → 500) a traversé 710 tests sans être détecté. `triValeur`
 * lui-même DOIT rester du texte (jamais un `Date` JavaScript, résolution milliseconde insuffisante
 * face à la microseconde PostgreSQL du curseur) — voir `pagination-triee.ts` et
 * `common/pagination/valeur-temporelle.ts`.
 */
function ligneOrBrute(champs: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'or1',
    numero: 'OR-000042',
    statut: 'en_cours',
    type: 'reparation',
    localisation: 'atelier',
    ouvertLe: '2026-07-01T08:00:00.000Z',
    restitutionPromiseLe: null,
    vehiculeId: 'v1',
    vehiculePlaque: 'VD 123456',
    vehiculeCanton: 'VD',
    vehiculeDesignation: 'VW Golf',
    vehiculeVin: 'VIN123',
    vehiculePremiereMiseEnCirculationLe: '2020-01-01',
    vehiculeIdentificationIncomplete: false,
    nombreLignes: 2,
    totalTtcCentimes: 15000,
    aAttenteAccord: false,
    aAttentePieces: false,
    aAttenteExterne: false,
    triValeur: '2026-07-01T08:00:00.000Z',
    ...champs,
  };
}

/**
 * `ligneClient` charge le client (`select().from().where().limit()`), puis DEUX requêtes
 * `execute()` s'enchaînent, dans l'ordre : (1) le complément de désambiguïsation comptoir
 * (`localite`/`nombreVehicules`/`dernierPassageLe`, une seule fois pour ce client — voir
 * `ServiceClientOrdresReparation.lister`), (2) la liste des OR elle-même. `executeRowsQueue`
 * fournit donc, DANS CET ORDRE, les lignes que chaque appel `execute()` doit rendre.
 */
function txFactice(
  clientRows: readonly unknown[],
  executeRowsQueue: ReadonlyArray<readonly unknown[]>,
) {
  const queue = [...executeRowsQueue];
  const whereArgs: unknown[] = [];
  const executeMock = vi.fn((_requete: unknown) => Promise.resolve({ rows: queue.shift() ?? [] }));
  const tx = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          whereArgs.push(cond);
          return { limit: () => Promise.resolve(clientRows) };
        },
      }),
    }),
    execute: executeMock,
  };
  return { tx: tx as unknown as TransactionDfa, whereArgs, executeMock };
}

/** Raccourci pour les tests qui ne portent pas sur la désambiguïsation comptoir : pas de complément (défauts null/0), puis les OR fournis. */
function txFacticeSimple(clientRows: readonly unknown[], lignesOr: readonly unknown[]) {
  return txFactice(clientRows, [[], lignesOr]);
}

describe('ServiceClientOrdresReparation.lister — priorité de blocage accord > pièces > externe (RM-58)', () => {
  it('un OR actif en attente accord ET pièces affiche "attente_accord" (l’accord prime)', async () => {
    const { tx } = txFacticeSimple(
      [ligneClient()],
      [
        ligneOrBrute({
          statut: 'en_cours',
          aAttenteAccord: true,
          aAttentePieces: true,
          aAttenteExterne: true,
        }),
      ],
    );
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, true);

    expect(page.donnees[0]?.etatAffiche).toBe('attente_accord');
  });

  it('sans attente accord, un OR actif en attente pièces ET externe affiche "attente_pieces"', async () => {
    const { tx } = txFacticeSimple(
      [ligneClient()],
      [
        ligneOrBrute({
          statut: 'ouvert',
          aAttenteAccord: false,
          aAttentePieces: true,
          aAttenteExterne: true,
        }),
      ],
    );
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, true);

    expect(page.donnees[0]?.etatAffiche).toBe('attente_pieces');
  });

  it("un OR déjà clôturé n'affiche jamais un état d'attente, même si les lignes en gardent la trace (l'attente ne concerne que le travail actif)", async () => {
    const { tx } = txFacticeSimple(
      [ligneClient()],
      [ligneOrBrute({ statut: 'cloture', aAttenteAccord: true })],
    );
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, true);

    expect(page.donnees[0]?.etatAffiche).toBe('cloture');
  });
});

describe('ServiceClientOrdresReparation.lister — visibilité des montants selon le droit appelant', () => {
  it('avecMontants: true expose totalTtcCentimes', async () => {
    const { tx } = txFacticeSimple([ligneClient()], [ligneOrBrute({ totalTtcCentimes: 24500 })]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, true);

    expect(page.donnees[0]?.totalTtcCentimes).toBe(24500);
  });

  it("avecMontants: false n'expose PAS totalTtcCentimes (clé absente, pas juste undefined)", async () => {
    const { tx } = txFacticeSimple([ligneClient()], [ligneOrBrute({ totalTtcCentimes: 24500 })]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

    expect(page.donnees[0]).not.toHaveProperty('totalTtcCentimes');
  });
});

describe('ServiceClientOrdresReparation.lister — client embarqué (désambiguïsation comptoir)', () => {
  it("un client sans adresse principale et sans véhicule détenu ressort avec localite: null et nombreVehicules: 0 (une seule requête complémentaire, pas par ligne d'OR)", async () => {
    const { tx, executeMock } = txFactice([ligneClient()], [[], [ligneOrBrute()]]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

    expect(page.donnees[0]?.client.localite).toBeNull();
    expect(page.donnees[0]?.client.nombreVehicules).toBe(0);
    expect(page.donnees[0]?.client.dernierPassageLe).toBeNull();
    // Une seule requête complémentaire (pas une par ligne d'OR), avant la requête des OR elle-même.
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it('le complément de désambiguïsation (localite/nombreVehicules/dernierPassageLe) est propagé sur le client embarqué de chaque OR', async () => {
    const { tx } = txFactice(
      [ligneClient()],
      [
        [
          {
            localite: 'Lausanne',
            nombreVehicules: 2,
            dernierPassageLe: '2026-06-01T00:00:00.000Z',
          },
        ],
        [ligneOrBrute()],
      ],
    );
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

    expect(page.donnees[0]?.client.localite).toBe('Lausanne');
    expect(page.donnees[0]?.client.nombreVehicules).toBe(2);
    expect(page.donnees[0]?.client.dernierPassageLe).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('ServiceClientOrdresReparation.lister — projection ouvertLe/restitutionPromiseLe en ISO', () => {
  it(
    'ouvertLe et restitutionPromiseLe, rendus EN CHAÎNE (forme défensive gérée par `enDate()`, en plus du ' +
      '`Date` que rend en pratique le pilote pg sur ce SQL brut), sont projetés en ISO sans planter. ' +
      'Régression couverte : un OR réel avec une date ' +
      'de restitution promise aurait fait planter `GET /clients/{id}/ordres-reparation` en 500 ' +
      '(`restitutionPromiseLe.toISOString is not a function`), symétrique au bug corrigé sur `GET /clients`.',
    async () => {
      const { tx } = txFacticeSimple(
        [ligneClient()],
        [
          ligneOrBrute({
            ouvertLe: '2026-07-01T08:00:00.000Z',
            restitutionPromiseLe: '2026-07-03T16:00:00.000Z',
          }),
        ],
      );
      const service = new ServiceClientOrdresReparation(accesFactice(tx));

      const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

      expect(page.donnees[0]?.ouvertLe).toBe('2026-07-01T08:00:00.000Z');
      expect(page.donnees[0]?.restitutionPromiseLe).toBe('2026-07-03T16:00:00.000Z');
    },
  );

  it('restitutionPromiseLe absente (OR sans promesse de restitution) est rendue null, jamais absente', async () => {
    const { tx } = txFacticeSimple([ligneClient()], [ligneOrBrute({ restitutionPromiseLe: null })]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

    expect(page.donnees[0]?.restitutionPromiseLe).toBeNull();
  });
});

describe(
  "ServiceClientOrdresReparation.lister — tri 'ouvertLe:desc' : le curseur doit préserver la " +
    "MICROSECONDE de PostgreSQL, jamais la tronquer à la milliseconde d'un `Date` JavaScript " +
    '(même défaut que `ServiceClient.lister` sur `creeLe:desc` — voir `pagination-triee.ts` et ' +
    '`common/pagination/valeur-temporelle.ts`)',
  () => {
    const PARAMS_OUVERT_LE_DESC: ParametresListeOrDuClient = { limite: 1, tri: 'ouvertLe:desc' };

    it('la colonne triValeur est sélectionnée avec un cast ::text explicite, jamais laissée au parseur par défaut du pilote', async () => {
      const { tx, executeMock } = txFacticeSimple(
        [ligneClient()],
        [ligneOrBrute(), ligneOrBrute({ id: 'or2' })],
      );
      const service = new ServiceClientOrdresReparation(accesFactice(tx));

      await service.lister(CTX, 'c1', PARAMS_OUVERT_LE_DESC, false);

      const requeteOr = executeMock.mock.calls[1]?.[0] as SQL;
      const { sql: texte } = dialect.sqlToQuery(requeteOr);
      expect(texte).toContain('(o.ouvert_le)::text as "triValeur"');
    });

    it(
      'deux OR partageant EXACTEMENT la même microseconde d’ouverture : le curseur encodé préserve ' +
        "la microseconde intacte, jamais tronquée — c'est cette troncature qui faisait sauter des " +
        'lignes entières de pagination',
      async () => {
        const MEME_INSTANT = '2026-07-01 08:00:00.123456+00';
        const ID_1 = '11111111-1111-4111-8111-111111111111';
        const ID_2 = '22222222-2222-4222-8222-222222222222';
        const { tx } = txFacticeSimple(
          [ligneClient()],
          [
            ligneOrBrute({ id: ID_1, ouvertLe: MEME_INSTANT, triValeur: MEME_INSTANT }),
            ligneOrBrute({ id: ID_2, ouvertLe: MEME_INSTANT, triValeur: MEME_INSTANT }),
          ],
        );
        const service = new ServiceClientOrdresReparation(accesFactice(tx));

        const page = await service.lister(CTX, 'c1', PARAMS_OUVERT_LE_DESC, false);

        expect(page.donnees).toHaveLength(1);
        expect(page.curseurSuivant).not.toBeNull();
        const decode = decoderCurseurTrie(page.curseurSuivant as string, 'ouvertLe:desc');
        expect(decode.valeur).toBe('2026-07-01T08:00:00.123456+00:00');
        expect(decode.valeur).not.toBe(new Date(MEME_INSTANT).toISOString());
      },
    );
  },
);

describe('ServiceClientOrdresReparation.lister — isolation tenant', () => {
  it("un clientId qui n'existe pas pour le tenant du contexte est 404 RESSOURCE_INTROUVABLE", async () => {
    const { tx } = txFactice([], []);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    await expect(service.lister(CTX, 'c-autre-tenant', PARAMS_DEFAUT, false)).rejects.toMatchObject(
      {
        code: 'RESSOURCE_INTROUVABLE',
        status: 404,
      },
    );
  });

  it('la vérification du client, le complément client et la requête des OR filtrent tous sur le tenantId du contexte', async () => {
    const { tx, whereArgs, executeMock } = txFacticeSimple([ligneClient()], [ligneOrBrute()]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

    expect(whereArgs).toHaveLength(1);
    const { sql: texteClient, params: paramsClient } = dialect.sqlToQuery(whereArgs[0] as SQL);
    expect(texteClient).toContain('tenant_id');
    expect(paramsClient).toContain('tid-1');

    const requeteExtra = executeMock.mock.calls[0]?.[0] as SQL;
    const { params: paramsExtra } = dialect.sqlToQuery(requeteExtra);
    expect(paramsExtra).toContain('tid-1');

    const requeteOr = executeMock.mock.calls[1]?.[0] as SQL;
    const { sql: texteOr, params: paramsOr } = dialect.sqlToQuery(requeteOr);
    expect(texteOr).toContain('o.tenant_id');
    expect(paramsOr).toContain('tid-1');
  });
});

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}
