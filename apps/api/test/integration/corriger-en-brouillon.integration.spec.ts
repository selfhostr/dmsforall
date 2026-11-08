/**
 * `POST /documents-vente/{id}/corriger` en mode `brouillon` (avoir total + NOUVEAU BROUILLON) sur
 * vraie base éphémère. Montants exacts : ligne de CHF 216.20 TTC.
 *   assujetti, 81 ‰ : HT 20'000, TVA 1'620, TTC 21'620 ;
 *   non assujetti   : HT 21'620, TVA 0, TTC 21'620 (taux ancien abandonné au régime ACTUEL).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE } from '@dfa/shared';

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

const NUMERO_TVA = 'CHE-116.281.710 TVA';

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

afterEach(async () => {
  await bdd.poolSuperutilisateur.query(
    'update tenant set assujetti_tva = true, numero_tva = $1 where id in ($2, $3)',
    [NUMERO_TVA, garage.tenantA.tenant.id, garage.tenantB.tenant.id],
  );
});

async function devenirNonAssujetti(): Promise<void> {
  await bdd.poolSuperutilisateur.query(
    'update tenant set assujetti_tva = false, numero_tva = null where id = $1',
    [garage.tenantA.tenant.id],
  );
}

async function api(tenant: 'A' | 'B' = 'A') {
  const t = tenant === 'A' ? garage.tenantA : garage.tenantB;
  const cookie = await cookiePour(t, 'direction');
  return {
    post: (chemin: string, corps: Record<string, unknown> = {}, cle: string = randomUUID()) =>
      ctx.requete
        .post(chemin)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .set(EN_TETE_IDEMPOTENCE, cle)
        .send(corps),
    get: (chemin: string) => ctx.requete.get(chemin).set('Cookie', cookie),
  };
}

interface Doc {
  id: string;
  statut: string;
  numero: string | null;
  totalHtCentimes: number;
  totalTvaCentimes: number;
  totalTtcCentimes: number;
  lignes: Array<{ regimeTva: string; tauxTvaPourmille: number }>;
}

/** Facture émise (assujetti, 81 ‰) de CHF 216.20 TTC. */
async function factureEmise(): Promise<string> {
  const a = await api('A');
  const cree = await a.post('/api/v1/documents-vente', {
    typeDocument: 'facture',
    siteId: garage.tenantA.tenant.sites[0]!.id,
    clientId: garage.tenantA.clients[0]!.id,
    devise: 'CHF',
    dateDocument: '2026-11-02',
    lignes: [
      {
        type: 'forfait',
        designation: 'Vidange',
        quantiteMillieme: 1000,
        prixUnitaireTtcCentimes: 21_620,
        tauxTvaPourmille: 81,
        datePrestation: '2026-11-02',
      },
    ],
  });
  expect(cree.status, JSON.stringify(cree.body)).toBe(201);
  const id = (cree.body as { donnees: { id: string } }).donnees.id;
  const emis = await a.post(`/api/v1/documents-vente/${id}/emettre`);
  expect(emis.status, JSON.stringify(emis.body)).toBe(200);
  return id;
}

const corriger = async (id: string, cle?: string) =>
  (await api('A')).post(
    `/api/v1/documents-vente/${id}/corriger`,
    { mode: 'brouillon', motif: 'erreur_taux' },
    cle,
  );

describe('corriger en brouillon', () => {
  it('assujetti : avoir total émis, brouillon lié, mêmes lignes (HT 20000 / TVA 1620 / TTC 21620)', async () => {
    const id = await factureEmise();
    const r = await corriger(id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const { mode, avoir, factureRemplacement } = (
      r.body as { donnees: { mode: string; avoir: Doc; factureRemplacement: Doc } }
    ).donnees;
    expect(mode).toBe('brouillon');
    expect(avoir.statut).toBe('emis');
    expect(avoir.totalTtcCentimes).toBe(-21_620);
    expect(factureRemplacement).toMatchObject({
      statut: 'brouillon',
      numero: null,
      totalHtCentimes: 20_000,
      totalTvaCentimes: 1_620,
      totalTtcCentimes: 21_620,
    });

    const origine = await bdd.poolSuperutilisateur.query(
      'select statut from document_vente where id = $1',
      [id],
    );
    expect(origine.rows).toEqual([{ statut: 'annule_par_avoir' }]);
    const lien = await bdd.poolSuperutilisateur.query(
      'select facture_corrigee_id, statut from document_vente where id = $1',
      [factureRemplacement.id],
    );
    expect(lien.rows).toEqual([{ facture_corrigee_id: id, statut: 'brouillon' }]);
  });

  it('non assujetti : le brouillon est recalculé au régime actuel (HT 21620 / TVA 0 / exclu)', async () => {
    const id = await factureEmise();
    await devenirNonAssujetti();
    const r = await corriger(id);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const brouillon = (r.body as { donnees: { factureRemplacement: Doc } }).donnees
      .factureRemplacement;
    expect(brouillon).toMatchObject({
      statut: 'brouillon',
      totalHtCentimes: 21_620,
      totalTvaCentimes: 0,
      totalTtcCentimes: 21_620,
    });
    expect(brouillon.lignes).toMatchObject([{ regimeTva: 'exclu', tauxTvaPourmille: 0 }]);
  });

  it('idempotent : même clé = même brouillon, un seul document de correction', async () => {
    const id = await factureEmise();
    const cle = randomUUID();
    const un = await corriger(id, cle);
    const deux = await corriger(id, cle);
    expect(un.status).toBe(201);
    expect(deux.status).toBe(201);
    expect(deux.headers['idempotency-rejeu']).toBe('true');
    expect(
      (deux.body as { donnees: { factureRemplacement: Doc } }).donnees.factureRemplacement.id,
    ).toBe((un.body as { donnees: { factureRemplacement: Doc } }).donnees.factureRemplacement.id);
    const n = await bdd.poolSuperutilisateur.query(
      'select count(*)::int as n from document_vente where facture_corrigee_id = $1',
      [id],
    );
    expect(n.rows).toEqual([{ n: 1 }]);
  });

  it('facture déjà corrigée : 409 FACTURE_DEJA_CORRIGEE, rien de créé', async () => {
    const id = await factureEmise();
    expect((await corriger(id)).status).toBe(201);
    const r = await corriger(id);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body).toMatchObject({ code: 'FACTURE_DEJA_CORRIGEE' });
    const n = await bdd.poolSuperutilisateur.query(
      "select count(*)::int as n from document_vente where type_document = 'avoir' and facture_annulee_id = $1",
      [id],
    );
    expect(n.rows).toEqual([{ n: 1 }]);
  });

  it('facture partiellement payée (CHF 50.00) : 409 FACTURE_CORRECTION_REGLEMENT_EXISTANT, facture intacte', async () => {
    const id = await factureEmise();
    await bdd.poolSuperutilisateur.query(
      "update document_vente set montant_regle_centimes = 5000, solde_centimes = 16620, statut_reglement = 'partiel' where id = $1",
      [id],
    );
    const r = await corriger(id);
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body).toMatchObject({ code: 'FACTURE_CORRECTION_REGLEMENT_EXISTANT' });
    const etat = await bdd.poolSuperutilisateur.query(
      'select statut from document_vente where id = $1',
      [id],
    );
    expect(etat.rows).toEqual([{ statut: 'emis' }]);
  });

  it('autre garage : 404, aucune fuite', async () => {
    const id = await factureEmise();
    const r = await (
      await api('B')
    ).post(`/api/v1/documents-vente/${id}/corriger`, {
      mode: 'brouillon',
      motif: 'erreur_taux',
    });
    expect(r.status).toBe(404);
  });

  it('mode brouillon + champsCorriges : 400', async () => {
    const id = await factureEmise();
    const r = await (
      await api('A')
    ).post(`/api/v1/documents-vente/${id}/corriger`, {
      mode: 'brouillon',
      motif: 'erreur_adresse',
      champsCorriges: { clientDesignation: 'X' },
    });
    expect(r.status).toBe(400);
  });
});
