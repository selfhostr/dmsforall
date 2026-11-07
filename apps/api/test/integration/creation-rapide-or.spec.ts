/**
 * `POST /ordres-reparation/creation-rapide` sur vraie base éphémère : client + véhicule + OR en une
 * transaction, doublon client non bloquant, atomicité (rien créé si l'OR est refusé), idempotence,
 * droits des créations embarquées, isolation tenant.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from '../lot1/fixtures/garage-demo-lot1';
import { construireCookiePour } from './ventes/fixtures-cycle-vente';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let garage: GarageDemoLot1Fixture;
let cookiePour: ReturnType<typeof construireCookiePour>;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  redis = await demarrerRedisEphemere();
  garage = await semerGarageDemoLot1(bdd);
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

function appeler(
  corps: Record<string, unknown>,
  opts: { role?: 'direction' | 'technicien'; tenant?: 'A' | 'B'; cle?: string } = {},
) {
  return cookiePour(
    opts.tenant === 'B' ? garage.tenantB : garage.tenantA,
    opts.role ?? 'direction',
  ).then((cookie) =>
    ctx.requete
      .post('/api/v1/ordres-reparation/creation-rapide')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie)
      .set('Idempotency-Key', opts.cle ?? randomUUID())
      .send(corps),
  );
}

const or = () => ({
  siteId: garage.tenantA.tenant.sites[0]!.id,
  type: 'reparation',
  statutInitial: 'ouvert',
  kilometrageEntree: 54000,
  demandes: [{ verbatim: 'Bruit au freinage' }],
  confirmations: ['OR_SANS_RDV', 'VEHICULE_DEUX_OR_OUVERTS', 'CLIENT_BLOQUE'],
});

async function compter(table: string, tenantId: string): Promise<number> {
  const r = await bdd.poolSuperutilisateur.query(
    `select count(*)::int as n from ${table} where tenant_id = $1`,
    [tenantId],
  );
  return r.rows[0].n as number;
}

interface Corps {
  donnees: {
    client: { id: string };
    vehicule: { id: string };
    ordreReparation: { id: string; statut: string; clientId?: string; vehiculeId?: string };
  };
  avertissements: { code: string }[];
}

describe('POST /ordres-reparation/creation-rapide', () => {
  it('client et véhicule nouveaux : les trois sont créés, le client détient le véhicule', async () => {
    const plaque = `VD ${String(Math.floor(100000 + Math.random() * 899999))}`;
    const r = await appeler({
      client: {
        nouveau: {
          type: 'particulier',
          nom: 'Rapide',
          prenom: 'Camille',
          telephone: '+41791234567',
        },
      },
      vehicule: { nouveau: { plaque, marque: 'Renault', modele: 'Clio' } },
      or: or(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const corps = r.body as Corps;
    expect(corps.donnees.ordreReparation.statut).toBe('ouvert');
    const det = await bdd.poolSuperutilisateur.query(
      'select client_id from vehicule_detention where vehicule_id = $1 and au is null',
      [corps.donnees.vehicule.id],
    );
    expect(det.rows[0].client_id).toBe(corps.donnees.client.id);
    const orBdd = await bdd.poolSuperutilisateur.query(
      'select client_id, vehicule_id from ordre_reparation where id = $1',
      [corps.donnees.ordreReparation.id],
    );
    expect(orBdd.rows[0]).toEqual({
      client_id: corps.donnees.client.id,
      vehicule_id: corps.donnees.vehicule.id,
    });
  }, 120_000);

  it('doublon client probable : avertissement, création non bloquée ; client et véhicule existants réutilisés', async () => {
    const existant = garage.tenantA.clients[0]!;
    const premier = await appeler({
      client: { nouveau: { type: 'particulier', nom: 'Doublon', email: 'doublon@example.ch' } },
      vehicule: { id: garage.tenantA.vehicules[1]!.id },
      or: or(),
    });
    expect(premier.status, JSON.stringify(premier.body)).toBe(201);
    const r = await appeler({
      client: { nouveau: { type: 'particulier', nom: 'Doublon', email: 'doublon@example.ch' } },
      vehicule: { id: garage.tenantA.vehicules[1]!.id },
      or: or(),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const corps = r.body as Corps;
    expect(corps.avertissements.map((a) => a.code)).toContain('CLIENT_DOUBLON_PROBABLE');
    expect(corps.donnees.client.id).not.toBe((premier.body as Corps).donnees.client.id);

    const r2 = await appeler({
      client: { id: existant.id },
      vehicule: { id: garage.tenantA.vehicules[2]!.id },
      or: or(),
    });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect((r2.body as Corps).donnees.client.id).toBe(existant.id);
  }, 120_000);

  it('atomicité : OR refusé (statut planifié inactif ou client inconnu) => ni client ni véhicule créés', async () => {
    const avant = {
      clients: await compter('client', garage.tenantA.tenant.id),
      vehicules: await compter('vehicule', garage.tenantA.tenant.id),
      ors: await compter('ordre_reparation', garage.tenantA.tenant.id),
    };
    // Site inexistant -> l'OR échoue après la création du client et du véhicule.
    const r = await appeler({
      client: { nouveau: { type: 'particulier', nom: 'Atomique' } },
      vehicule: { nouveau: { plaque: 'VD 999001', marque: 'Fiat', modele: 'Panda' } },
      or: { ...or(), siteId: randomUUID() },
    });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await compter('client', garage.tenantA.tenant.id)).toBe(avant.clients);
    expect(await compter('vehicule', garage.tenantA.tenant.id)).toBe(avant.vehicules);
    expect(await compter('ordre_reparation', garage.tenantA.tenant.id)).toBe(avant.ors);
  }, 120_000);

  it('idempotence : un rejeu rend les mêmes ids sans rien recréer ; autre corps => 409', async () => {
    const cle = randomUUID();
    const corps = {
      client: { nouveau: { type: 'entreprise', nom: 'Transports Rejeu SA' } },
      vehicule: { nouveau: { plaque: 'VD 999002', marque: 'Iveco', modele: 'Daily' } },
      or: or(),
    };
    const a = await appeler(corps, { cle });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const nClients = await compter('client', garage.tenantA.tenant.id);
    const b = await appeler(corps, { cle });
    expect(b.status).toBe(201);
    expect(b.headers['idempotency-rejeu']).toBe('true');
    expect((b.body as Corps).donnees.ordreReparation.id).toBe(
      (a.body as Corps).donnees.ordreReparation.id,
    );
    expect(await compter('client', garage.tenantA.tenant.id)).toBe(nClients);
    const c = await appeler({ ...corps, or: { ...or(), kilometrageEntree: 1 } }, { cle });
    expect(c.status).toBe(409);
  }, 120_000);

  it('droits : un rôle sans client.creer ne crée pas de client par ce raccourci ; autre tenant => 404 sur client existant', async () => {
    const r = await appeler(
      {
        client: { nouveau: { type: 'particulier', nom: 'Interdit' } },
        vehicule: { id: garage.tenantA.vehicules[0]!.id },
        or: or(),
      },
      { role: 'technicien' },
    );
    expect(r.status).toBe(403);

    const croise = await appeler(
      {
        client: { id: garage.tenantA.clients[0]!.id },
        vehicule: { id: garage.tenantA.vehicules[0]!.id },
        or: or(),
      },
      { tenant: 'B' },
    );
    expect([403, 404]).toContain(croise.status);
  }, 120_000);
});
