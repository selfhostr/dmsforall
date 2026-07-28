import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { ServiceClientVehicules } from './service-client-vehicules';
import type { ParametresListeVehiculesDuClient } from './schemas';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };
const dialect = new PgDialect();
const PARAMS_DEFAUT: ParametresListeVehiculesDuClient = {
  limite: 20,
  tri: 'plaque:asc',
  inclureAnciennesDetentions: false,
};

function txFactice(reponsesExecute: ReadonlyArray<{ rows: readonly unknown[] }>) {
  const file = [...reponsesExecute];
  const tx = { execute: vi.fn(() => Promise.resolve(file.shift() ?? { rows: [] })) };
  return tx as unknown as TransactionDfa;
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceClientVehicules.lister — isolation tenant', () => {
  it("un clientId qui n'existe pas pour le tenant du contexte est 404 RESSOURCE_INTROUVABLE", async () => {
    const tx = txFactice([{ rows: [] }]);
    const service = new ServiceClientVehicules(accesFactice(tx));

    await expect(service.lister(CTX, 'c-autre-tenant', PARAMS_DEFAUT)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
      status: 404,
    });
  });

  it('la vérification du client ET la liste des véhicules filtrent toutes deux sur le tenantId du contexte', async () => {
    const tx = txFactice([{ rows: [{ id: 'c1' }] }, { rows: [] }]);
    const service = new ServiceClientVehicules(accesFactice(tx));

    await service.lister(CTX, 'c1', PARAMS_DEFAUT);

    const appels = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(appels).toHaveLength(2);
    for (const [requete] of appels) {
      const { sql: texte, params } = dialect.sqlToQuery(requete as SQL);
      expect(texte).toContain('tenant_id');
      expect(params).toContain('tid-1');
    }
  });
});

describe('ServiceClientVehicules.lister — RM-20 : les détentions closes ne sont visibles que sur demande explicite', () => {
  it('par défaut (inclureAnciennesDetentions: false), la requête exclut les détentions closes', async () => {
    const tx = txFactice([{ rows: [{ id: 'c1' }] }, { rows: [] }]);
    const service = new ServiceClientVehicules(accesFactice(tx));

    await service.lister(CTX, 'c1', PARAMS_DEFAUT);

    const appels = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const { sql: texteListe } = dialect.sqlToQuery(appels[1]![0] as SQL);
    expect(texteListe).toContain('d.au is null');
  });

  it('avec inclureAnciennesDetentions: true, la requête ne restreint plus aux détentions ouvertes', async () => {
    const tx = txFactice([{ rows: [{ id: 'c1' }] }, { rows: [] }]);
    const service = new ServiceClientVehicules(accesFactice(tx));

    await service.lister(CTX, 'c1', { ...PARAMS_DEFAUT, inclureAnciennesDetentions: true });

    const appels = (tx.execute as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const { sql: texteListe } = dialect.sqlToQuery(appels[1]![0] as SQL);
    expect(texteListe).not.toContain('d.au is null');
  });
});
