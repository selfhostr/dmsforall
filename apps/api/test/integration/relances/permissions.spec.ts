/**
 * Matrice rôle × action — les QUATRE routes du module Relances sont gouvernées par un SEUL jeu de
 * rôles (`direction`, `comptable`), sur vraie Postgres éphémère et vrai contrôleur HTTP, même
 * patron que `test/integration/tableau-bord/permissions-et-etancheite.spec.ts`.
 *
 * `auth/matrice-droits.ts::DROITS_RELANCES_PAR_ROLE` (lu, jamais modifié — hors périmètre) :
 * `direction`/`comptable` seuls détiennent les quatre actions `relances.facturation.*` ; `admin`
 * en est explicitement exclu (RF-115, même séparation des pouvoirs que le tableau de bord
 * financier — « même LIRE la configuration des relances expose une politique de recouvrement »,
 * commentaire de tête de `relances.controller.ts`).
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RoleUtilisateur } from '@dfa/shared';

import { demarrerBaseEphemere, type BaseEphemere } from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import {
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
} from '../../lot1/fixtures/garage-demo-lot1';
import { construireCookiePour, creerPosteAtelierPourTest, envoyer, getRegles, planifier } from './fixtures-relances';

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

const ROLES_AUTORISES: readonly RoleUtilisateur[] = ['direction', 'comptable'];
const ROLES_REFUSES: readonly RoleUtilisateur[] = [
  'admin', // RF-115, littéral : la séparation des pouvoirs que ce test existe pour prouver.
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
];

async function putRegle(cookie: string): Promise<{ readonly status: number; readonly body: unknown }> {
  const reponse = await ctx.requete
    .put('/api/v1/relances/regles/facture_echue')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .set('Cookie', cookie)
    .send({ actif: false, delaisJours: [], canaux: [] });
  return { status: reponse.status, body: reponse.body };
}

// =================================================================================================
// GET /relances/regles
// =================================================================================================

describe('GET /relances/regles — direction/comptable seuls', () => {
  it.each(ROLES_AUTORISES)('%s est autorisé (200)', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await getRegles(ctx, cookie);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
    expect(Array.isArray(reponse.body)).toBe(true);
  });

  it.each(ROLES_REFUSES)('%s est refusé (403 DROIT_INSUFFISANT), y compris admin', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await getRegles(ctx, cookie);
    expect(reponse.status, `role=${role} : ${JSON.stringify(reponse.body)}`).toBe(403);
    expect((reponse.body as { code: string }).code).toBe('DROIT_INSUFFISANT');
  });

  it('poste_atelier est refusé (403) — aucun droit relances, par construction', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const poste = await creerPosteAtelierPourTest(bdd, garage.tenantA.tenant.id, site, 'regles');
    const cookie = await cookieDeSessionPour(ctx, poste.email, poste.motDePasseClair);
    const reponse = await getRegles(ctx, cookie);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(403);
  });

  it('sans session (401), avant tout accès base', async () => {
    const reponse = await ctx.requete.get('/api/v1/relances/regles');
    expect(reponse.status).toBe(401);
  });
});

// =================================================================================================
// PUT /relances/regles/:typeRelance
// =================================================================================================

describe('PUT /relances/regles/facture_echue — direction/comptable seuls', () => {
  it.each(ROLES_AUTORISES)('%s est autorisé (200)', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await putRegle(cookie);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(200);
  });

  it.each(ROLES_REFUSES)('%s est refusé (403 DROIT_INSUFFISANT), y compris admin', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await putRegle(cookie);
    expect(reponse.status, `role=${role} : ${JSON.stringify(reponse.body)}`).toBe(403);
    expect((reponse.body as { code: string }).code).toBe('DROIT_INSUFFISANT');
  });

  it('sans session (401)', async () => {
    // `Origin` requis même sans cookie : la garde anti-CSRF est vérifiée AVANT l'auth (voir
    // CONTRIBUTING.md, piège vérifié) — sans elle, la réponse serait 403 et se lirait faussement comme
    // un problème d'authentification plutôt que l'absence de session qu'on veut prouver ici.
    const reponse = await ctx.requete
      .put('/api/v1/relances/regles/facture_echue')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .send({ actif: false, delaisJours: [], canaux: [] });
    expect(reponse.status).toBe(401);
  });
});

// =================================================================================================
// POST /relances/facturation/planifier
// =================================================================================================

describe('POST /relances/facturation/planifier — direction/comptable seuls', () => {
  it.each(ROLES_AUTORISES)('%s est autorisé (200)', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await planifier(ctx, cookie); // lève si non-200 : la garantie EST le test ici.
    expect(reponse).toEqual(
      expect.objectContaining({ creees: expect.any(Number), ignorees: expect.any(Number) }),
    );
  });

  it.each(ROLES_REFUSES)('%s est refusé (403 DROIT_INSUFFISANT), y compris admin', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await ctx.requete
      .post('/api/v1/relances/facturation/planifier')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie);
    expect(reponse.status, `role=${role} : ${JSON.stringify(reponse.body)}`).toBe(403);
    expect((reponse.body as { code: string }).code).toBe('DROIT_INSUFFISANT');
  });

  it('sans session (401)', async () => {
    const reponse = await ctx.requete
      .post('/api/v1/relances/facturation/planifier')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE);
    expect(reponse.status).toBe(401);
  });
});

// =================================================================================================
// POST /relances/facturation/envoyer
// =================================================================================================

describe('POST /relances/facturation/envoyer — direction/comptable seuls', () => {
  it.each(ROLES_AUTORISES)('%s est autorisé (200)', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await envoyer(ctx, cookie);
    expect(reponse).toEqual({ envoyees: 0, echouees: 0, annulees: 0, encoreATraiter: false });
  });

  it.each(ROLES_REFUSES)('%s est refusé (403 DROIT_INSUFFISANT), y compris admin', async (role) => {
    const cookie = await cookiePour(garage.tenantA, role);
    const reponse = await ctx.requete
      .post('/api/v1/relances/facturation/envoyer')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie);
    expect(reponse.status, `role=${role} : ${JSON.stringify(reponse.body)}`).toBe(403);
    expect((reponse.body as { code: string }).code).toBe('DROIT_INSUFFISANT');
  });

  it('poste_atelier est refusé (403)', async () => {
    const site = garage.tenantA.tenant.sites[0]!.id;
    const poste = await creerPosteAtelierPourTest(bdd, garage.tenantA.tenant.id, site, 'envoyer');
    const cookie = await cookieDeSessionPour(ctx, poste.email, poste.motDePasseClair);
    const reponse = await ctx.requete
      .post('/api/v1/relances/facturation/envoyer')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .set('Cookie', cookie);
    expect(reponse.status, JSON.stringify(reponse.body)).toBe(403);
  });

  it('sans session (401)', async () => {
    const reponse = await ctx.requete
      .post('/api/v1/relances/facturation/envoyer')
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE);
    expect(reponse.status).toBe(401);
  });
});
