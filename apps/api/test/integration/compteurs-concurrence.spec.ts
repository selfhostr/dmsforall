/**
 * Preuve en base réelle (testcontainers) que `ServiceCompteurs.prochainNumero` tient sous
 * concurrence, y compris pour le TOUT PREMIER numéro d'une clé (la ligne de compteur n'existe pas
 * encore : sans `insert … on conflict do nothing`, deux transactions tentaient l'INSERT et la
 * seconde heurtait `compteur_document_uk` -> 500 sur les premières créations d'un garage neuf).
 * Chaque appel ouvre sa propre transaction via `AccesBase.enTenant`, comme une requête HTTP.
 */

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AccesBase, ContexteTenant } from '../../src/db';
import { ServiceCompteursImpl } from '../../src/parametrage/compteurs/service-compteurs';
import { creerAccesBaseTest, demarrerRedisEphemere, type RedisEphemere } from '../setup/app-test';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';

const N = 8;

let bdd: BaseEphemere;
let redis: RedisEphemere;
let accesBase: AccesBase;
let fermerAcces: () => Promise<void>;
const service = new ServiceCompteursImpl();

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  redis = await demarrerRedisEphemere();
  ({ accesBase, fermer: fermerAcces } = await creerAccesBaseTest(bdd, redis.url));
}, 180_000);

afterAll(async () => {
  await fermerAcces?.();
  await redis?.fermer();
  await bdd?.fermer();
});

async function semerTenant(): Promise<{ tenantId: string; siteId: string }> {
  const tenantId = randomUUID();
  const siteId = randomUUID();
  const suffixe = tenantId.slice(0, 8);
  await bdd.poolSuperutilisateur.query(
    `insert into tenant (id, slug, raison_sociale, numero_tva, pays, langue_defaut, statut)
     values ($1, $2, $3, null, 'CH', 'fr', 'actif')`,
    [tenantId, `cpt-${suffixe}`, `Garage compteur ${suffixe} SA`],
  );
  await bdd.poolSuperutilisateur.query(
    `insert into site (id, tenant_id, code, nom, rue, npa, localite, pays, actif)
     values ($1, $2, 'S1', 'Site unique', null, null, null, 'CH', true)`,
    [siteId, tenantId],
  );
  return { tenantId, siteId };
}

function numerosConcurrents(tenantId: string, siteId: string | null, n: number): Promise<number[]> {
  const ctx: ContexteTenant = { tenantId, utilisateurId: null, requeteId: 'test-compteur' };
  return Promise.all(
    Array.from({ length: n }, () =>
      accesBase.enTenant(ctx, (tx) =>
        service.prochainNumero(tx, { tenantId, typeDocument: 'or', annee: 2026, siteId }),
      ),
    ),
  );
}

const trier = (v: number[]): number[] => [...v].sort((a, b) => a - b);
const suite = (debut: number, n: number): number[] =>
  Array.from({ length: n }, (_, i) => debut + i);

describe('ServiceCompteurs.prochainNumero sous concurrence (base réelle)', () => {
  it('premier numéro, portée tenant : N appels simultanés -> 1..N distincts', async () => {
    const { tenantId } = await semerTenant();
    expect(trier(await numerosConcurrents(tenantId, null, N))).toEqual(suite(1, N));
  });

  it('premier numéro, portée site : N appels simultanés -> 1..N distincts', async () => {
    const { tenantId, siteId } = await semerTenant();
    expect(trier(await numerosConcurrents(tenantId, siteId, N))).toEqual(suite(1, N));
  });

  it('compteur existant : N autres appels simultanés -> N+1..2N, sans trou', async () => {
    const { tenantId } = await semerTenant();
    await numerosConcurrents(tenantId, null, N);
    expect(trier(await numerosConcurrents(tenantId, null, N))).toEqual(suite(N + 1, N));
  });

  it('rollback de la transaction qui crée la ligne : aucun trou pour la suivante', async () => {
    const { tenantId } = await semerTenant();
    const ctx: ContexteTenant = { tenantId, utilisateurId: null, requeteId: 'test-rollback' };
    const clef = { tenantId, typeDocument: 'or', annee: 2026, siteId: null };
    await expect(
      accesBase.enTenant(ctx, async (tx) => {
        await service.prochainNumero(tx, clef);
        throw new Error('annulation volontaire');
      }),
    ).rejects.toThrow('annulation volontaire');
    expect(await accesBase.enTenant(ctx, (tx) => service.prochainNumero(tx, clef))).toBe(1);
  });
});
