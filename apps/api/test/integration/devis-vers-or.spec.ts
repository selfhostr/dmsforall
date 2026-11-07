/**
 * Devis -> OR, sur vraie base éphémère : lignes reprises avec montants identiques, lien posé,
 * devis accepté, idempotence, un seul OR par devis, devis sans véhicule refusé, isolation tenant,
 * liste `typeDocument=devis` et PDF de devis.
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

describe('POST /documents-vente/{id}/creer-ordre-reparation', () => {
  it('reprend les lignes à l’identique, accepte le devis, pose le lien, et rejoue sans doublon', async () => {
    const { id, cookie } = await devisEmis(true);
    const cle = randomUUID();
    const r = await creerOr(cookie, id, cle);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const donnees = r.body.donnees as {
      ordreReparation: { id: string; lignes: { montants?: { montantTtcCentimes: number } }[] };
      devisStatut: string;
      nombreLignesReprises: number;
    };
    expect(donnees.devisStatut).toBe('accepte');
    expect(donnees.nombreLignesReprises).toBe(2);
    expect(donnees.ordreReparation.lignes).toHaveLength(2);

    const devis = await ctx.requete.get(`/api/v1/documents-vente/${id}`).set('Cookie', cookie);
    const ttcDevis = devis.body as { totalTtcCentimes: number; statut: string };
    expect(ttcDevis.statut).toBe('accepte');
    const somme = donnees.ordreReparation.lignes.reduce(
      (s, l) => s + (l.montants?.montantTtcCentimes ?? 0),
      0,
    );
    expect(somme).toBe(ttcDevis.totalTtcCentimes);

    const lien = await bdd.poolSuperutilisateur.query(
      'select count(*)::int as n from ordre_reparation where devis_origine_id = $1',
      [id],
    );
    expect(lien.rows[0].n).toBe(1);

    const rejeu = await creerOr(cookie, id, cle);
    expect(rejeu.status).toBe(201);
    expect(rejeu.headers['idempotency-rejeu']).toBe('true');
    expect((rejeu.body.donnees as { ordreReparation: { id: string } }).ordreReparation.id).toBe(
      donnees.ordreReparation.id,
    );

    const autre = await creerOr(cookie, id);
    expect(autre.status).toBe(409);
    expect((autre.body as { code?: string }).code).toBe('DOCUMENT_SOURCE_DEJA_TRANSFORME');
  }, 120_000);

  it('refuse un devis sans véhicule (409 CONFLIT) sans rien créer', async () => {
    const { id, cookie } = await devisEmis(false);
    const r = await creerOr(cookie, id);
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.body)).toContain('vehicule_requis');
    const n = await bdd.poolSuperutilisateur.query(
      'select count(*)::int as n from ordre_reparation where devis_origine_id = $1',
      [id],
    );
    expect(n.rows[0].n).toBe(0);
  }, 120_000);

  it('un autre tenant ne voit pas le devis (404)', async () => {
    const { id } = await devisEmis(true);
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    const r = await creerOr(cookieB, id);
    expect(r.status).toBe(404);
  }, 120_000);
});

describe('devis : liste et PDF', () => {
  it('GET /documents-vente?typeDocument=devis ne rend que des devis, et un id client inconnu rend vide', async () => {
    const { cookie } = await devisEmis(true);
    const r = await ctx.requete
      .get('/api/v1/documents-vente?typeDocument=devis&limite=50')
      .set('Cookie', cookie);
    expect(r.status).toBe(200);
    const liste = (r.body as { donnees: { typeDocument: string }[] }).donnees;
    expect(liste.length).toBeGreaterThan(0);
    expect(liste.every((d) => d.typeDocument === 'devis')).toBe(true);
    const vide = await ctx.requete
      .get(`/api/v1/documents-vente?typeDocument=devis&clientId=${randomUUID()}`)
      .set('Cookie', cookie);
    expect((vide.body as { donnees: unknown[] }).donnees).toHaveLength(0);
  }, 120_000);

  it('GET /documents-vente/{id}/pdf rend un PDF pour un devis, et refuse toujours une facture brouillon', async () => {
    const { id, cookie } = await devisEmis(true);
    const pdf = await ctx.requete.get(`/api/v1/documents-vente/${id}/pdf`).set('Cookie', cookie);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('Devis-');

    const facture = await creerDocumentVente(ctx, cookie, {
      typeDocument: 'facture',
      siteId: garage.tenantA.tenant.sites[0]!.id,
      clientId: garage.tenantA.clients[0]!.id,
      dateDocument: '2026-11-01',
      nombreLignesPrimitives: 1,
    });
    const fid = (facture.body.donnees as { id: string }).id;
    const refus = await ctx.requete.get(`/api/v1/documents-vente/${fid}/pdf`).set('Cookie', cookie);
    expect(refus.status).toBe(409);
    expect((refus.body as { code?: string }).code).toBe('DOCUMENT_PDF_INDISPONIBLE');
  }, 120_000);
});
