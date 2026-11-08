/**
 * Modules activables (migration 0092) sur vraie base éphémère : réglage `GET|PATCH
 * /parametres-entreprise/modules`, `modulesActifs` dans `GET /auth/moi`, refus des ÉCRITURES d'un
 * module retiré (`403 MODULE_DESACTIVE`), lectures toujours permises, dépendances, étanchéité entre
 * garages, restauration à la réactivation.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EN_TETE_IDEMPOTENCE, MODULES_APP } from '@dfa/shared';

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

afterEach(async () => {
  await bdd.poolSuperutilisateur.query(`update tenant set modules_desactives = '{}'`);
});

async function avec(tenant: 'A' | 'B' = 'A', role: 'direction' | 'chef_atelier' = 'direction') {
  const t = tenant === 'A' ? garage.tenantA : garage.tenantB;
  const cookie = await cookiePour(t, role);
  return {
    get: (chemin: string) => ctx.requete.get(chemin).set('Cookie', cookie),
    patch: (chemin: string, corps: Record<string, unknown>) =>
      ctx.requete
        .patch(chemin)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .send(corps),
    post: (chemin: string, corps: Record<string, unknown> = {}) =>
      ctx.requete
        .post(chemin)
        .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
        .set('Cookie', cookie)
        .set(EN_TETE_IDEMPOTENCE, randomUUID())
        .send(corps),
  };
}

const CHEMIN = '/api/v1/parametres-entreprise/modules';
// Écriture du module pneus avec un corps volontairement invalide : module actif -> la garde laisse
// passer et c'est la validation (400) ou la ressource (404) qui répond ; module retiré -> 403.
const ECRITURE_PNEUS = `/api/v1/vehicules/${randomUUID()}/depots-pneus`;
const LECTURE_PNEUS = '/api/v1/depots-pneus/a-relancer';

describe('modules activables', () => {
  it('par défaut tout est actif, dans le réglage comme dans /auth/moi', async () => {
    const api = await avec('A');
    const r = await api.get(CHEMIN);
    expect(r.status).toBe(200);
    expect(r.body.modulesDesactives).toEqual([]);
    expect(r.body.modulesActifs).toEqual([...MODULES_APP]);
    const moi = await api.get('/api/v1/auth/moi');
    expect(moi.body.modulesActifs).toEqual([...MODULES_APP]);
  });

  it('chef d’atelier : lecture permise, écriture refusée 403 DROIT_INSUFFISANT', async () => {
    const api = await avec('A', 'chef_atelier');
    expect((await api.get(CHEMIN)).status).toBe(200);
    const r = await api.patch(CHEMIN, { modulesDesactives: ['pneus'] });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('DROIT_INSUFFISANT');
  });

  it('retirer pneus : l’écriture répond 403 MODULE_DESACTIVE, la lecture reste permise', async () => {
    const api = await avec('A');
    expect((await api.post(ECRITURE_PNEUS)).status).not.toBe(403);

    const patch = await api.patch(CHEMIN, { modulesDesactives: ['pneus'] });
    expect(patch.status).toBe(200);
    expect(patch.body.modulesActifs).not.toContain('pneus');

    const ecriture = await api.post(ECRITURE_PNEUS);
    expect(ecriture.status).toBe(403);
    expect(ecriture.body.code).toBe('MODULE_DESACTIVE');
    expect(ecriture.headers['content-type']).toMatch(/problem\+json/);

    expect((await api.get(LECTURE_PNEUS)).status).toBe(200);
    expect((await api.get('/api/v1/auth/moi')).body.modulesActifs).not.toContain('pneus');
  });

  it('réactiver restaure l’écriture, sans donnée perdue', async () => {
    const api = await avec('A');
    await api.patch(CHEMIN, { modulesDesactives: ['pneus'] });
    expect((await api.post(ECRITURE_PNEUS)).status).toBe(403);
    const r = await api.patch(CHEMIN, { modulesDesactives: [] });
    expect(r.body.modulesActifs).toEqual([...MODULES_APP]);
    expect((await api.post(ECRITURE_PNEUS)).status).not.toBe(403);
  });

  it('retirer atelier retire aussi pointage et tablettes, sans changer le choix enregistré', async () => {
    const api = await avec('A');
    const r = await api.patch(CHEMIN, { modulesDesactives: ['atelier'] });
    expect(r.body.modulesDesactives).toEqual(['atelier']);
    expect(r.body.modulesActifs).not.toContain('pointage');
    expect(r.body.modulesActifs).not.toContain('tablettes');
    expect(r.body.modulesActifs).toContain('planning');
  });

  it('l’étanchéité entre garages tient : le garage B n’est pas affecté par le choix de A', async () => {
    const a = await avec('A');
    const b = await avec('B');
    await a.patch(CHEMIN, { modulesDesactives: ['pneus'] });
    expect((await b.get(CHEMIN)).body.modulesDesactives).toEqual([]);
    expect((await b.post(ECRITURE_PNEUS)).status).not.toBe(403);
  });

  it('refuse un module inconnu ou du socle (400) et journalise le changement', async () => {
    const api = await avec('A');
    expect((await api.patch(CHEMIN, { modulesDesactives: ['facturation'] })).status).toBe(400);
    expect((await api.patch(CHEMIN, { modulesDesactives: ['inconnu'] })).status).toBe(400);
    await api.patch(CHEMIN, { modulesDesactives: ['ventes'] });
    const audit = await bdd.poolSuperutilisateur.query(
      `select valeur_avant, valeur_apres from audit_atelier where tenant_id = $1 and champ = 'modules_desactives'`,
      [garage.tenantA.tenant.id],
    );
    expect(audit.rows).toContainEqual({ valeur_avant: [], valeur_apres: ['ventes'] });
  });
});
