/**
 * Isolation tenant vue depuis l'extérieur, en HTTP pur, sans jamais toucher directement à la
 * base : c'est la preuve que l'isolation posée en base (rls.spec.ts) est effectivement
 * respectée par la couche API (contrat gelé §4, endpoints #5-#6).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demarrerBaseEphemere, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemo, type GarageDemoFixture } from '../fixtures/garage-demo';
import {
  creerAppTest,
  demarrerRedisEphemere,
  extraireValeurCookie,
  type AppTest,
  type RedisEphemere,
} from '../setup/app-test';

let bdd: BaseEphemere;
let redis: RedisEphemere;
let ctx: AppTest;
let demo: GarageDemoFixture;

async function cookieDeSessionPour(email: string, motDePasse: string): Promise<string> {
  const reponse = await ctx.requete
    .post('/api/v1/auth/connexion')
    .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
    .send({ email, motDePasse });
  if (reponse.status !== 200) {
    throw new Error(
      `connexion de test échouée (${reponse.status}) : ${JSON.stringify(reponse.body)}`,
    );
  }
  const token = extraireValeurCookie(reponse, ctx.config.SESSION_COOKIE_NOM);
  return `${ctx.config.SESSION_COOKIE_NOM}=${token}`;
}

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  // Défensif : si `beforeAll` a échoué avant d'initialiser une ressource, `?.` évite de
  // masquer la VRAIE erreur (celle du beforeAll) derrière un TypeError secondaire ici.
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('isolation tenant de bout en bout via HTTP', () => {
  it('GET /api/v1/sites, avec une session du tenant A, ne rend AUCUN site du tenant B', async () => {
    const utilisateurA = demo.tenantA.utilisateurs[0]!;
    const cookie = await cookieDeSessionPour(utilisateurA.email, utilisateurA.motDePasseClair);

    const reponse = await ctx.requete.get('/api/v1/sites').set('Cookie', cookie);
    expect(reponse.status).toBe(200);

    const idsRendus: string[] = reponse.body.donnees.map((site: { id: string }) => site.id);
    const idsSitesDuTenantB = demo.tenantB.sites.map((site) => site.id);

    expect(idsRendus.some((id) => idsSitesDuTenantB.includes(id))).toBe(false);
    expect([...idsRendus].sort()).toEqual([...demo.tenantA.sites.map((site) => site.id)].sort());
  });

  it("GET /api/v1/sites/{id d'un site du tenant B}, sous une session du tenant A, rend 404 — jamais 403 : un 403 divulguerait l'existence de la ressource", async () => {
    const utilisateurA = demo.tenantA.utilisateurs[0]!;
    const cookie = await cookieDeSessionPour(utilisateurA.email, utilisateurA.motDePasseClair);
    const siteDuTenantB = demo.tenantB.sites[0]!;

    const reponse = await ctx.requete
      .get(`/api/v1/sites/${siteDuTenantB.id}`)
      .set('Cookie', cookie);
    expect(reponse.status).toBe(404);
    expect(reponse.body.code).toBe('RESSOURCE_INTROUVABLE');
  });

  it("à l'inverse, GET /api/v1/sites/{id} pour un site du PROPRE tenant rend bien 200", async () => {
    const utilisateurA = demo.tenantA.utilisateurs[0]!;
    const cookie = await cookieDeSessionPour(utilisateurA.email, utilisateurA.motDePasseClair);
    const siteDuTenantA = demo.tenantA.sites[0]!;

    const reponse = await ctx.requete
      .get(`/api/v1/sites/${siteDuTenantA.id}`)
      .set('Cookie', cookie);
    expect(reponse.status).toBe(200);
    expect(reponse.body.id).toBe(siteDuTenantA.id);
  });
});
