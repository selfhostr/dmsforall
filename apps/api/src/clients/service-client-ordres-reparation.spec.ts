import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
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

function ligneOrBrute(champs: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'or1',
    numero: 'OR-000042',
    statut: 'en_cours',
    type: 'reparation',
    localisation: 'atelier',
    ouvertLe: new Date('2026-07-01T08:00:00.000Z'),
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
    triValeur: new Date('2026-07-01T08:00:00.000Z'),
    ...champs,
  };
}

function txFactice(clientRows: readonly unknown[], executeRows: readonly unknown[]) {
  const whereArgs: unknown[] = [];
  const executeMock = vi.fn((_requete: unknown) => Promise.resolve({ rows: executeRows }));
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

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceClientOrdresReparation.lister — priorité de blocage accord > pièces > externe (RM-58)', () => {
  it('un OR actif en attente accord ET pièces affiche "attente_accord" (l’accord prime)', async () => {
    const { tx } = txFactice(
      [ligneClient()],
      [ligneOrBrute({ statut: 'en_cours', aAttenteAccord: true, aAttentePieces: true, aAttenteExterne: true })],
    );
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, true);

    expect(page.donnees[0]?.etatAffiche).toBe('attente_accord');
  });

  it('sans attente accord, un OR actif en attente pièces ET externe affiche "attente_pieces"', async () => {
    const { tx } = txFactice(
      [ligneClient()],
      [ligneOrBrute({ statut: 'ouvert', aAttenteAccord: false, aAttentePieces: true, aAttenteExterne: true })],
    );
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, true);

    expect(page.donnees[0]?.etatAffiche).toBe('attente_pieces');
  });

  it("un OR déjà clôturé n'affiche jamais un état d'attente, même si les lignes en gardent la trace (l'attente ne concerne que le travail actif)", async () => {
    const { tx } = txFactice(
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
    const { tx } = txFactice([ligneClient()], [ligneOrBrute({ totalTtcCentimes: 24500 })]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, true);

    expect(page.donnees[0]?.totalTtcCentimes).toBe(24500);
  });

  it("avecMontants: false n'expose PAS totalTtcCentimes (clé absente, pas juste undefined)", async () => {
    const { tx } = txFactice([ligneClient()], [ligneOrBrute({ totalTtcCentimes: 24500 })]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    const page = await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

    expect(page.donnees[0]).not.toHaveProperty('totalTtcCentimes');
  });
});

describe('ServiceClientOrdresReparation.lister — isolation tenant', () => {
  it("un clientId qui n'existe pas pour le tenant du contexte est 404 RESSOURCE_INTROUVABLE", async () => {
    const { tx } = txFactice([], []);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    await expect(service.lister(CTX, 'c-autre-tenant', PARAMS_DEFAUT, false)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('la vérification du client et la requête des OR filtrent toutes deux sur le tenantId du contexte', async () => {
    const { tx, whereArgs, executeMock } = txFactice([ligneClient()], [ligneOrBrute()]);
    const service = new ServiceClientOrdresReparation(accesFactice(tx));

    await service.lister(CTX, 'c1', PARAMS_DEFAUT, false);

    expect(whereArgs).toHaveLength(1);
    const { sql: texteClient, params: paramsClient } = dialect.sqlToQuery(whereArgs[0] as SQL);
    expect(texteClient).toContain('tenant_id');
    expect(paramsClient).toContain('tid-1');

    const requeteOr = executeMock.mock.calls[0]?.[0] as SQL;
    const { sql: texteOr, params: paramsOr } = dialect.sqlToQuery(requeteOr);
    expect(texteOr).toContain('o.tenant_id');
    expect(paramsOr).toContain('tid-1');
  });
});
