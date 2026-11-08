/**
 * Recette #64 sur vraie base : bon de commande / facture créés SANS ligne depuis un dossier de
 * vente reprennent le prix du véhicule (422 sinon), et un encaissement espèces arrondi enregistre
 * l'écriture d'arrondi (facture 100.03 payée 100.05 -> solde 0, arrondi -2 ct imputé).
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE } from '@dfa/shared';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import {
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import {
  construireCookiePour,
  creerDossier,
  creerVehicule,
  emettreDocument,
  mettreEnStock,
} from './fixtures-cycle-vente';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;
let cookiePour: ReturnType<typeof construireCookiePour>;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
  cookiePour = construireCookiePour(ctx);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

interface CorpsReponse {
  readonly code?: string;
  readonly donnees: {
    readonly id: string;
    readonly lignes: readonly { prixUnitaireTtcCentimes: number; quantiteMillieme: number }[];
    readonly totalTtcCentimes: number;
    readonly totalTvaCentimes: number;
    readonly totalHtCentimes: number;
    readonly imputations: readonly { nature: string; montantCentimes: number }[];
  };
}

async function post(cookie: string, chemin: string, corps: Record<string, unknown>) {
  const r = await ctx.requete
    .post(chemin)
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .set(EN_TETE_IDEMPOTENCE, randomUUID())
    .send(corps);
  return { status: r.status, body: r.body as CorpsReponse };
}

async function dossierAvecVehicule(prix: number | null | 'sans-vehicule') {
  const tenant = garage.tenantA;
  const cookie = await cookiePour(tenant, 'direction');
  const site = tenant.tenant.sites[0]!.id;
  const client = tenant.clients[0]!.id;
  let vehiculeId: string | undefined;
  if (prix !== 'sans-vehicule') {
    const v = await creerVehicule(ctx, cookie, randomUUID().replace(/-/g, ''));
    vehiculeId = (v.body.donnees as { id: string }).id;
    const stock = await mettreEnStock(
      ctx,
      cookie,
      vehiculeId,
      site,
      prix === null ? { prixVenteAfficheCentimes: null } : { prixVenteAfficheCentimes: prix },
    );
    expect(stock.status, JSON.stringify(stock.body)).toBe(201);
  }
  const d = await creerDossier(ctx, cookie, {
    siteId: site,
    clientAcheteurId: client,
    ...(vehiculeId ? { vehiculeId } : {}),
  });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  return { cookie, site, client, dossierId: (d.body.donnees as { id: string }).id };
}

describe.each(['bon_commande', 'facture'] as const)(
  '%s créé depuis un dossier de vente',
  (type) => {
    it('sans prix de vente : 422 DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS, aucun document créé', async () => {
      const { cookie, site, client, dossierId } = await dossierAvecVehicule(null);
      const r = await post(cookie, '/api/v1/documents-vente', {
        typeDocument: type,
        siteId: site,
        clientId: client,
        devise: 'CHF',
        dossierVenteId: dossierId,
        lignes: [],
      });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS');
    });

    it('sans véhicule : 422 DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS', async () => {
      const { cookie, site, client, dossierId } = await dossierAvecVehicule('sans-vehicule');
      const r = await post(cookie, '/api/v1/documents-vente', {
        typeDocument: type,
        siteId: site,
        clientId: client,
        devise: 'CHF',
        dossierVenteId: dossierId,
        lignes: [],
      });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('DOCUMENT_DOSSIER_VENTE_PRIX_REQUIS');
    });

    it("avec prix (19'900.00) : une ligne au prix du véhicule, TVA 8.1 % exacte (HT 18408.88, TVA 1491.12)", async () => {
      const { cookie, site, client, dossierId } = await dossierAvecVehicule(1_990_000);
      const r = await post(cookie, '/api/v1/documents-vente', {
        typeDocument: type,
        siteId: site,
        clientId: client,
        devise: 'CHF',
        dossierVenteId: dossierId,
        lignes: [],
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      const doc = r.body.donnees;
      expect(doc.lignes).toHaveLength(1);
      expect(doc.lignes[0]?.prixUnitaireTtcCentimes).toBe(1_990_000);
      expect(doc.lignes[0]?.quantiteMillieme).toBe(1000);
      expect(doc.totalTtcCentimes).toBe(1_990_000);
      expect(doc.totalTvaCentimes).toBe(149_112);
      expect(doc.totalHtCentimes).toBe(1_840_888);
    });
  },
);

describe('espèces arrondies au 5 centimes', () => {
  async function factureEmise(ttc: number) {
    const tenant = garage.tenantA;
    const cookie = await cookiePour(tenant, 'direction');
    const site = tenant.tenant.sites[0]!.id;
    const client = tenant.clients[0]!.id;
    const c = await post(cookie, '/api/v1/documents-vente', {
      typeDocument: 'facture',
      siteId: site,
      clientId: client,
      devise: 'CHF',
      dateDocument: '2026-11-08',
      lignes: [
        {
          type: 'forfait',
          designation: 'Prestation',
          quantiteMillieme: 1000,
          prixUnitaireTtcCentimes: ttc,
          tauxTvaPourmille: 81,
          datePrestation: '2026-11-08',
        },
      ],
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const e = await emettreDocument(ctx, cookie, c.body.donnees.id);
    expect(e.status, JSON.stringify(e.body)).toBe(200);
    return { cookie, site, client, id: c.body.donnees.id };
  }

  it('facture 100.03 payée 100.05 : solde 0, imputation arrondi -2 ct enregistrée', async () => {
    const f = await factureEmise(10003);
    const p = await post(f.cookie, '/api/v1/paiements', {
      siteId: f.site,
      dateValeur: '2026-11-08',
      moyen: 'especes',
      montantCentimes: 10005,
      devise: 'CHF',
      payeurClientId: f.client,
      payeurLibelle: 'Client',
      imputations: [
        { documentId: f.id, montantCentimes: 10005, nature: 'reglement' },
        { documentId: f.id, montantCentimes: -2, nature: 'arrondi' },
      ],
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const imputations = p.body.donnees.imputations;
    expect(imputations.find((i) => i.nature === 'arrondi')?.montantCentimes).toBe(-2);
    expect(imputations.find((i) => i.nature === 'reglement')?.montantCentimes).toBe(10005);
    const doc = await ctx.requete.get(`/api/v1/documents-vente/${f.id}`).set('Cookie', f.cookie);
    expect(doc.body.soldeCentimes).toBe(0);
  });

  it('100.03 en espèces sans arrondi : refusé (multiple de 5 ct)', async () => {
    const f = await factureEmise(10003);
    const p = await post(f.cookie, '/api/v1/paiements', {
      siteId: f.site,
      dateValeur: '2026-11-08',
      moyen: 'especes',
      montantCentimes: 10003,
      devise: 'CHF',
      payeurClientId: f.client,
      payeurLibelle: 'Client',
      imputations: [{ documentId: f.id, montantCentimes: 10003, nature: 'reglement' }],
    });
    expect(p.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(p.body)).toContain('especes_pas_multiple_5_centimes');
  });
});
