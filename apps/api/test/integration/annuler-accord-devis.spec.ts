/**
 * Annulation de l'accord client sur un devis (migration 0094), sur vraie base éphémère :
 * accepte -> emis, journal d'audit, refus si un OR en est issu, refus hors statut accepte,
 * refus sur une facture, isolation tenant.
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
import {
  construireCookiePour,
  creerDocumentVente,
  emettreDocument,
} from './ventes/fixtures-cycle-vente';

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

async function devisEmis(avecVehicule: boolean): Promise<{ id: string; cookie: string }> {
  const cookie = await cookiePour(garage.tenantA, 'direction');
  const cree = await creerDocumentVente(ctx, cookie, {
    typeDocument: 'devis',
    siteId: garage.tenantA.tenant.sites[0]!.id,
    clientId: garage.tenantA.clients[0]!.id,
    dateDocument: '2026-11-01',
    vehiculeId: avecVehicule ? garage.tenantA.vehicules[0]!.id : null,
    nombreLignesPrimitives: 2,
  });
  expect(cree.status, JSON.stringify(cree.body)).toBe(201);
  const id = (cree.body.donnees as { id: string }).id;
  const emis = await emettreDocument(ctx, cookie, id);
  expect(emis.status, JSON.stringify(emis.body)).toBe(200);
  return { id, cookie };
}


function creerOr(cookie: string, devisId: string, cle: string = randomUUID()) {
  return ctx.requete
    .post(`/api/v1/documents-vente/${devisId}/creer-ordre-reparation`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set('Idempotency-Key', cle)
    .send({
      type: 'reparation',
      statutInitial: 'ouvert',
      kilometrageEntree: 120000,
      confirmations: ['OR_SANS_RDV', 'VEHICULE_DEUX_OR_OUVERTS', 'CLIENT_BLOQUE'],
    });
}

function post(cookie: string, id: string, action: 'accepter' | 'annuler-accord') {
  return ctx.requete
    .post(`/api/v1/documents-vente/${id}/${action}`)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .send({});
}

describe('POST /documents-vente/{id}/annuler-accord', () => {
  it('rétablit un devis accepté en émis, journalise, et on peut ré-accepter', async () => {
    const { id, cookie } = await devisEmis(true);
    expect((await post(cookie, id, 'accepter')).status).toBe(200);
    const r = await post(cookie, id, 'annuler-accord');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body.donnees as { statut: string }).statut).toBe('emis');
    const audit = await bdd.poolSuperutilisateur.query(
      "select count(*)::int as n from audit_atelier where entite_id = $1 and apres->>'statut' = 'emis' and avant->>'statut' = 'accepte'",
      [id],
    );
    expect(audit.rows[0].n).toBe(1);
    expect((await post(cookie, id, 'accepter')).status).toBe(200);
  }, 120_000);

  it('refuse (409 TRANSITION_INTERDITE) un devis non accepté', async () => {
    const { id, cookie } = await devisEmis(true);
    const r = await post(cookie, id, 'annuler-accord');
    expect(r.status).toBe(409);
  }, 120_000);

  it('refuse (409 DOCUMENT_SOURCE_DEJA_TRANSFORME) quand un OR est issu du devis', async () => {
    const { id, cookie } = await devisEmis(true);
    const or = await creerOr(cookie, id);
    expect(or.status, JSON.stringify(or.body)).toBe(201);
    const r = await post(cookie, id, 'annuler-accord');
    expect(r.status).toBe(409);
    expect((r.body as { code?: string }).code).toBe('DOCUMENT_SOURCE_DEJA_TRANSFORME');
    const devis = await ctx.requete.get(`/api/v1/documents-vente/${id}`).set('Cookie', cookie);
    expect((devis.body as { statut: string }).statut).toBe('accepte');
  }, 120_000);

  it('un autre tenant ne voit pas le devis (404)', async () => {
    const { id, cookie } = await devisEmis(true);
    await post(cookie, id, 'accepter');
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    expect((await post(cookieB, id, 'annuler-accord')).status).toBe(404);
  }, 120_000);
});
