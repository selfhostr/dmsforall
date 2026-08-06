/**
 * Isolation tenant (règle n°1 du projet) — les relances d'un garage sont invisibles ET non
 * déclenchables depuis un autre, sur vraie Postgres éphémère (RLS réel) et vrai contrôleur HTTP.
 * Même patron que `test/integration/tableau-bord/permissions-et-etancheite.spec.ts` §4.
 *
 * Preuve à DEUX niveaux, comme là-bas :
 *  - applicatif : `POST /relances/facturation/planifier` sous le tenant A ne crée ni ne compte
 *    JAMAIS une ligne pour une facture du tenant B (le SQL de `planifier()` scope explicitement
 *    `d.tenant_id = ctx.tenantId`) ;
 *  - RLS : une lecture directe de `relance_planifiee` sous le contexte `app.tenant_id` de A ne
 *    rend JAMAIS une ligne de B, MÊME en connaissant son `id` exact — le filet, pas le mécanisme
 *    principal (CONTRIBUTING.md : « le RLS est le filet, pas le mécanisme »).
 *
 * Périmètre d'écriture : `apps/api/test/**` uniquement (CONTRIBUTING.md).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  configurerDelaiPaiementImmediatPourTest,
  configurerRegleFactureEchue,
  construireCookiePour,
  creerFactureEmisePourTest,
  joursAvant,
  lireRelancesPlanifieesPourObjet,
  planifier,
} from './fixtures-relances';

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

  // Condition + règle configurées INDÉPENDAMMENT sur les DEUX tenants — chacun a sa propre ligne
  // `regle_relance` (contrainte unique `(tenant_id, type_relance)`), aucun partage possible.
  await configurerDelaiPaiementImmediatPourTest(
    ctx,
    garage.tenantA,
    cookiePour,
    garage.tenantA.clients[0]!.id,
  );
  await configurerDelaiPaiementImmediatPourTest(
    ctx,
    garage.tenantB,
    cookiePour,
    garage.tenantB.clients[0]!.id,
  );

  for (const tenant of [garage.tenantA, garage.tenantB]) {
    const cookieDirection = await cookiePour(tenant, 'direction');
    const reponse = await configurerRegleFactureEchue(ctx, cookieDirection, {
      actif: true,
      delaisJours: [5],
      canaux: ['email'],
    });
    if (reponse.status !== 200) {
      throw new Error(
        `configuration regle_relance (tenant ${tenant.tenant.id}) a échoué : ${JSON.stringify(reponse.body)}`,
      );
    }
  }
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

describe('isolation tenant — planification et lecture de relance_planifiee', () => {
  it('une facture échue du tenant B n’est ni planifiée, ni visible, ni comptée sous le contexte du tenant A', async () => {
    const dateDocument = joursAvant(10); // palier 1 dû (5 ≤ 10) pour les deux tenants.

    const factureB = await creerFactureEmisePourTest(ctx, garage.tenantB, cookiePour, {
      siteId: garage.tenantB.tenant.sites[0]!.id,
      clientId: garage.tenantB.clients[0]!.id,
      dateDocument,
    });

    // A planifie AVANT que B ne le fasse lui-même : si la portée tenant fuitait, c'est ICI, sous
    // le contexte de A, que la facture de B serait ramassée par le `select ... where d.tenant_id
    // = ctx.tenantId` de `planifier()`.
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    await planifier(ctx, cookieA);

    // Lecture SOUS LE CONTEXTE DE A (RLS, `app.tenant_id` posé à l'id de A) d'un `objet_id` qui
    // appartient RÉELLEMENT à B : la ligne existe en base (voir le contrôle positif ci-dessous)
    // mais reste invisible sous A — preuve RLS, pas seulement une preuve applicative.
    const vueDepuisA = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      factureB.id,
    );
    expect(
      vueDepuisA,
      'une lecture sous le tenant A ne doit jamais rendre une ligne de B, même en connaissant son objet_id exact',
    ).toEqual([]);

    // Contrôle positif n°1 : B, sous SON PROPRE contexte, plani­fie bien sa propre facture —
    // sinon l'absence ci-dessus ne prouverait rien (il n'y aurait simplement rien à isoler).
    const cookieB = await cookiePour(garage.tenantB, 'direction');
    await planifier(ctx, cookieB);
    const vueDepuisB = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantB.tenant.id,
      factureB.id,
    );
    expect(vueDepuisB).toHaveLength(1);
    expect(vueDepuisB[0]!.statut).toBe('prete');

    // Contrôle positif n°2 : et TOUJOURS invisible sous A, même maintenant que la ligne existe
    // réellement en base (élimine l'hypothèse « A ne voit rien parce qu'il n'y a encore rien »).
    const vueDepuisAApres = await lireRelancesPlanifieesPourObjet(
      bdd,
      garage.tenantA.tenant.id,
      factureB.id,
    );
    expect(vueDepuisAApres).toEqual([]);
  });

  it('planifier() sous le tenant A ne fait jamais grimper le compteur "creees" à cause d’une facture due chez B', async () => {
    const dateDocument = joursAvant(10);
    const cookieA = await cookiePour(garage.tenantA, 'direction');
    const cookieB = await cookiePour(garage.tenantB, 'direction');

    // Baseline de A, tenant propre déjà utilisé par le test précédent : delta, pas une valeur
    // absolue (même doctrine que `test/integration/tableau-bord/`).
    const baselineA = await planifier(ctx, cookieA);

    const factureB = await creerFactureEmisePourTest(ctx, garage.tenantB, cookiePour, {
      siteId: garage.tenantB.tenant.sites[0]!.id,
      clientId: garage.tenantB.clients[0]!.id,
      dateDocument,
    });

    const apresCreationB = await planifier(ctx, cookieA);
    expect(
      apresCreationB.creees - baselineA.creees,
      `la création d'une facture due chez B (${factureB.id}) a fait bouger le compteur "creees" de A : fuite inter-tenant.`,
    ).toBe(0);

    // Contrôle positif : B, lui, voit bien sa facture comme candidate.
    const reponseB = await planifier(ctx, cookieB);
    expect(reponseB.creees + reponseB.ignorees).toBeGreaterThan(0);
  });
});
