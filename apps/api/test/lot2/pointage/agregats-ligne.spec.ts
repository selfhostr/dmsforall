/**
 * `GET /pointages/agregats-ligne` — pour un OR donné, le temps réellement pointé face au temps
 * barémé, PAR LIGNE (`packages/shared/src/contrats/pointage/agregat-ligne.ts`,
 * `apps/api/src/pointage/regles-pointage.ts::calculerAgregatsTempsLigne`). Règles couvertes,
 * chacune dans un test dédié plutôt qu'un unique gros scénario, pour qu'un échec pointe
 * directement la règle violée :
 *
 *   - RM-97 : un pointage `en_cours` est signalé (`pointageEnCours: true`) mais SA DURÉE n'est
 *     JAMAIS additionnée à `dureePointeeCentiemes` — même si la colonne porte déjà une valeur
 *     numérique (cas qui ne devrait pas survenir en production, mais qui isole précisément où
 *     l'exclusion a lieu : dans l'agrégation, pas dans la génération de la donnée) ;
 *   - seuls `termine`/`valide`/`verrouille` sont sommés ;
 *   - `ecartCentiemes` = pointé − barémé (positif = dépassement), `null` sans barème ;
 *   - une ligne sans barème ET sans pointage est OMISE ; une ligne barémée à zéro pointage est
 *     INCLUSE (pas commencée est une information, pas une absence) ;
 *   - 404 si l'OR n'existe pas POUR CE TENANT (un OR d'un autre tenant rend le même 404) ;
 *   - isolation tenant stricte (IDOR HTTP + RLS brut).
 *
 * MÊME PATRON HTTP que `test/lot1/isolation-vehicules.spec.ts` (cookie de session via le vrai
 * endpoint de connexion, assertions sur le code `problem+json`). Les lignes d'OR et pointages de
 * ce fichier sont semés LOCALEMENT (raw SQL via `ecrireSousTenant`, même doctrine que
 * `garage-demo-lot1.ts`/`garage-demo-lot2.ts`) plutôt que d'étendre les fixtures partagées : le
 * scénario (barème + pointages de statuts variés sur des lignes précises) n'a d'usage que dans ce
 * fichier.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  requeteSousTenant,
  type BaseEphemere,
} from '../../setup/postgres-ephemere';
import {
  creerAppTest,
  demarrerRedisEphemere,
  type AppTest,
  type RedisEphemere,
} from '../../setup/app-test';
import {
  creerOrPourTest,
  semerGarageDemoLot1,
  type GarageDemoLot1Fixture,
  type OrDeTest,
} from '../../lot1/fixtures/garage-demo-lot1';
import { cookieDeSessionPour } from '../../lot1/isolation-http-aide';
import type { TenantFixture } from '../../fixtures/garage-demo';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

// -------------------------------------------------------------------------------------------
// Semis locaux : ligne d'OR avec un barème choisi, pointage avec statut/durée choisis.
// -------------------------------------------------------------------------------------------

async function creerLigneOrAvecBaremePourTest(
  tenant: TenantFixture,
  ordreReparationId: string,
  numeroOrdre: number,
  tempsBaremeCentiemes: number | null,
): Promise<{ readonly id: string }> {
  const id = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into ligne_or
         (id, tenant_id, ordre_reparation_id, numero_ordre, type, origine, statut,
          designation, temps_bareme_centiemes, montant_ht_centimes, montant_tva_centimes, montant_ttc_centimes)
       values ($1, $2, $3, $4, 'forfait', 'commandee', 'proposee', $5, $6, 10000, 810, 10810)`,
      [
        id,
        tenant.id,
        ordreReparationId,
        numeroOrdre,
        `Ligne agrégat #${String(numeroOrdre)}`,
        tempsBaremeCentiemes,
      ],
    );
  });
  return { id };
}

type StatutPointageDeTest = 'en_cours' | 'termine' | 'valide' | 'verrouille';

async function creerPointageLignePourTest(
  tenant: TenantFixture,
  params: {
    readonly siteId: string;
    readonly technicienId: string;
    readonly ordreReparationId: string;
    readonly ligneOrId: string;
    readonly statut: StatutPointageDeTest;
    readonly dureeArrondieCentiemes: number | null;
  },
): Promise<{ readonly id: string }> {
  const id = randomUUID();
  const debutLe = new Date('2026-07-01T08:00:00.000Z');
  const finLe = params.statut === 'en_cours' ? null : new Date('2026-07-01T09:00:00.000Z');
  await ecrireSousTenant(bdd.poolApp, tenant.id, async (client: PoolClient) => {
    await client.query(
      `insert into pointage
         (id, tenant_id, site_id, technicien_id, statut, nature, ordre_reparation_id, ligne_or_id,
          debut_le, fin_le, duree_arrondie_centiemes)
       values ($1, $2, $3, $4, $5, 'productif_ligne', $6, $7, $8, $9, $10)`,
      [
        id,
        tenant.id,
        params.siteId,
        params.technicienId,
        params.statut,
        params.ordreReparationId,
        params.ligneOrId,
        debutLe,
        finLe,
        params.dureeArrondieCentiemes,
      ],
    );
  });
  return { id };
}

// -------------------------------------------------------------------------------------------
// Scénario du tenant A — un OR, cinq lignes couvrant chaque cas du contrat.
// -------------------------------------------------------------------------------------------

interface ScenarioAgregat {
  readonly or: OrDeTest;
  /** Barème 500, deux pointages FERMÉS (termine 300 + valide 150) : sommés, total 450. */
  readonly ligneSommeeDeuxPointages: { readonly id: string };
  /** Barème 200, UN pointage en_cours portant DÉJÀ une durée non nulle (999) : la durée ne doit
   *  JAMAIS être additionnée, seul `pointageEnCours: true` doit apparaître. */
  readonly ligneEnCoursIgnoree: { readonly id: string };
  /** Sans barème, sans aucun pointage : doit être ABSENTE de la réponse. */
  readonly ligneOmise: { readonly id: string };
  /** Barème 100, aucun pointage : doit apparaître à dureePointeeCentiemes: 0 (pas "pas commencé" = absent). */
  readonly ligneBareeeSansPointage: { readonly id: string };
  /** Sans barème, un pointage verrouille (75) : incluse (a un pointage), ecart null (pas de barème). */
  readonly ligneSansBaremeAvecPointage: { readonly id: string };
}

async function semerScenario(t: GarageDemoLot1Fixture['tenantA']): Promise<ScenarioAgregat> {
  const siteId = t.tenant.sites[0]!.id;
  const technicienId = t.utilisateursParRole.technicien.id;
  const or = await creerOrPourTest(bdd, t.tenant, siteId, t.clients[0]!, t.vehicules[0]!);

  const ligneSommeeDeuxPointages = await creerLigneOrAvecBaremePourTest(t.tenant, or.id, 1, 500);
  await creerPointageLignePourTest(t.tenant, {
    siteId,
    technicienId,
    ordreReparationId: or.id,
    ligneOrId: ligneSommeeDeuxPointages.id,
    statut: 'termine',
    dureeArrondieCentiemes: 300,
  });
  await creerPointageLignePourTest(t.tenant, {
    siteId,
    technicienId,
    ordreReparationId: or.id,
    ligneOrId: ligneSommeeDeuxPointages.id,
    statut: 'valide',
    dureeArrondieCentiemes: 150,
  });

  const ligneEnCoursIgnoree = await creerLigneOrAvecBaremePourTest(t.tenant, or.id, 2, 200);
  await creerPointageLignePourTest(t.tenant, {
    siteId,
    technicienId,
    ordreReparationId: or.id,
    ligneOrId: ligneEnCoursIgnoree.id,
    statut: 'en_cours',
    // Valeur délibérément non nulle : prouve que l'exclusion vient de l'agrégation (statut),
    // pas d'une colonne vide qui rendrait le test inoffensif par construction.
    dureeArrondieCentiemes: 999,
  });

  const ligneOmise = await creerLigneOrAvecBaremePourTest(t.tenant, or.id, 3, null);

  const ligneBareeeSansPointage = await creerLigneOrAvecBaremePourTest(t.tenant, or.id, 4, 100);

  const ligneSansBaremeAvecPointage = await creerLigneOrAvecBaremePourTest(
    t.tenant,
    or.id,
    5,
    null,
  );
  await creerPointageLignePourTest(t.tenant, {
    siteId,
    technicienId,
    ordreReparationId: or.id,
    ligneOrId: ligneSansBaremeAvecPointage.id,
    statut: 'verrouille',
    dureeArrondieCentiemes: 75,
  });

  return {
    or,
    ligneSommeeDeuxPointages,
    ligneEnCoursIgnoree,
    ligneOmise,
    ligneBareeeSansPointage,
    ligneSansBaremeAvecPointage,
  };
}

interface AgregatLigneReponse {
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  readonly dureePointeeCentiemes: number;
  readonly nombrePointages: number;
  readonly pointageEnCours: boolean;
  readonly tempsBaremeCentiemes: number | null;
  readonly ecartCentiemes: number | null;
}

let scenarioA: ScenarioAgregat;
let orTenantB: OrDeTest;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);
  scenarioA = await semerScenario(garage.tenantA);

  // OR de tenant B, avec au moins une ligne barémée + un pointage — sert aux tests d'isolation
  // (jamais consulté depuis tenant A sans que ce soit précisément ce qu'on veut prouver refusé).
  const siteIdB = garage.tenantB.tenant.sites[0]!.id;
  orTenantB = await creerOrPourTest(
    bdd,
    garage.tenantB.tenant,
    siteIdB,
    garage.tenantB.clients[0]!,
    garage.tenantB.vehicules[0]!,
  );
  const ligneB = await creerLigneOrAvecBaremePourTest(garage.tenantB.tenant, orTenantB.id, 1, 300);
  await creerPointageLignePourTest(garage.tenantB.tenant, {
    siteId: siteIdB,
    technicienId: garage.tenantB.utilisateursParRole.technicien.id,
    ordreReparationId: orTenantB.id,
    ligneOrId: ligneB.id,
    statut: 'termine',
    dureeArrondieCentiemes: 120,
  });

  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

/** `technicien` porte `atelier.pointage.lire` (matrice-droits.ts) — suffisant pour cette route,
 *  qui n'a explicitement AUCUNE restriction de vue équipe (voir l'en-tête du contrat). */
async function cookieLecteurPointage(
  t: GarageDemoLot1Fixture['tenantA'] | GarageDemoLot1Fixture['tenantB'],
): Promise<string> {
  const u = t.utilisateursParRole.technicien;
  return cookieDeSessionPour(ctx, u.email, u.motDePasseClair);
}

async function appelerAgregat(cookie: string, ordreReparationId: string) {
  return ctx.requete
    .get('/api/v1/pointages/agregats-ligne')
    .query({ ordreReparationId })
    .set('Cookie', cookie);
}

function trouverLigne(
  lignes: readonly AgregatLigneReponse[],
  ligneOrId: string,
): AgregatLigneReponse {
  const trouvee = lignes.find((l) => l.ligneOrId === ligneOrId);
  if (!trouvee)
    throw new Error(
      `Ligne ${ligneOrId} absente de la réponse — voir la liste complète : ${JSON.stringify(lignes)}`,
    );
  return trouvee;
}

// -------------------------------------------------------------------------------------------
// RM-97 : un pointage en_cours n'est JAMAIS sommé, mais signale pointageEnCours
// -------------------------------------------------------------------------------------------

describe('RM-97 — un pointage en_cours est signalé mais jamais agrégé dans dureePointeeCentiemes', () => {
  it('la ligne avec un unique pointage en_cours (durée déjà non nulle en base) rend dureePointeeCentiemes: 0 et pointageEnCours: true', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);

    expect(reponse.status).toBe(200);
    const corps = reponse.body as {
      ordreReparationId: string;
      lignes: readonly AgregatLigneReponse[];
    };
    expect(corps.ordreReparationId).toBe(scenarioA.or.id);

    const ligne = trouverLigne(corps.lignes, scenarioA.ligneEnCoursIgnoree.id);
    expect(ligne.dureePointeeCentiemes).toBe(0);
    expect(ligne.pointageEnCours).toBe(true);
    expect(ligne.nombrePointages).toBe(1);
    expect(ligne.tempsBaremeCentiemes).toBe(200);
    expect(ligne.ecartCentiemes).toBe(0 - 200);
  });
});

// -------------------------------------------------------------------------------------------
// Seuls termine/valide/verrouille sont sommés — valeurs EXACTES, jamais toBeCloseTo
// -------------------------------------------------------------------------------------------

describe('seuls les statuts termine/valide/verrouille contribuent à dureePointeeCentiemes', () => {
  it('deux pointages FERMÉS (termine 300 + valide 150) sur la même ligne sont sommés à 450 exactement', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };

    const ligne = trouverLigne(corps.lignes, scenarioA.ligneSommeeDeuxPointages.id);
    expect(ligne.dureePointeeCentiemes).toBe(450);
    expect(ligne.nombrePointages).toBe(2);
    expect(ligne.pointageEnCours).toBe(false);
  });

  it('un pointage verrouille seul est sommé intégralement (75), même sans barème', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };

    const ligne = trouverLigne(corps.lignes, scenarioA.ligneSansBaremeAvecPointage.id);
    expect(ligne.dureePointeeCentiemes).toBe(75);
    expect(ligne.nombrePointages).toBe(1);
  });
});

// -------------------------------------------------------------------------------------------
// ecartCentiemes = pointé - barémé, positif = dépassement ; null sans barème
// -------------------------------------------------------------------------------------------

describe('ecartCentiemes — valeur exacte, signe correct, null uniquement sans barème', () => {
  it('450 pointé - 500 barémé = -50 (marge restante, PAS un dépassement)', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    const ligne = trouverLigne(corps.lignes, scenarioA.ligneSommeeDeuxPointages.id);
    expect(ligne.ecartCentiemes).toBe(-50);
  });

  it('0 pointé (en_cours exclu) - 200 barémé = -200', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    const ligne = trouverLigne(corps.lignes, scenarioA.ligneEnCoursIgnoree.id);
    expect(ligne.ecartCentiemes).toBe(-200);
  });

  it('0 pointé - 100 barémé (ligne jamais pointée) = -100', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    const ligne = trouverLigne(corps.lignes, scenarioA.ligneBareeeSansPointage.id);
    expect(ligne.dureePointeeCentiemes).toBe(0);
    expect(ligne.tempsBaremeCentiemes).toBe(100);
    expect(ligne.ecartCentiemes).toBe(-100);
  });

  it('sans barème (tempsBaremeCentiemes: null), ecartCentiemes est null même avec du temps pointé', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    const ligne = trouverLigne(corps.lignes, scenarioA.ligneSansBaremeAvecPointage.id);
    expect(ligne.tempsBaremeCentiemes).toBeNull();
    expect(ligne.ecartCentiemes).toBeNull();
  });

  it('un dépassement produit un écart STRICTEMENT positif — cas construit séparément avec un total supérieur au barème', async () => {
    // Scénario dédié : barème 100, deux pointages fermés totalisant 250 -> écart +150 (dépassement).
    const t = garage.tenantA;
    const siteId = t.tenant.sites[0]!.id;
    const orDepasse = await creerOrPourTest(bdd, t.tenant, siteId, t.clients[0]!, t.vehicules[0]!);
    const ligneDepasse = await creerLigneOrAvecBaremePourTest(t.tenant, orDepasse.id, 1, 100);
    await creerPointageLignePourTest(t.tenant, {
      siteId,
      technicienId: t.utilisateursParRole.technicien.id,
      ordreReparationId: orDepasse.id,
      ligneOrId: ligneDepasse.id,
      statut: 'termine',
      dureeArrondieCentiemes: 250,
    });

    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, orDepasse.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    const ligne = trouverLigne(corps.lignes, ligneDepasse.id);
    expect(ligne.dureePointeeCentiemes).toBe(250);
    expect(ligne.tempsBaremeCentiemes).toBe(100);
    expect(ligne.ecartCentiemes).toBe(150);
  });
});

// -------------------------------------------------------------------------------------------
// Omission / inclusion des lignes selon barème et pointages
// -------------------------------------------------------------------------------------------

describe('inclusion des lignes — omise seulement si ni barème ni pointage', () => {
  it('la ligne sans barème ET sans aucun pointage est ABSENTE de la réponse', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    expect(corps.lignes.some((l) => l.ligneOrId === scenarioA.ligneOmise.id)).toBe(false);
  });

  it('la ligne barémée à zéro pointage est INCLUSE, à dureePointeeCentiemes: 0 (pas absente)', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    const ligne = trouverLigne(corps.lignes, scenarioA.ligneBareeeSansPointage.id);
    expect(ligne.dureePointeeCentiemes).toBe(0);
    expect(ligne.nombrePointages).toBe(0);
    expect(ligne.pointageEnCours).toBe(false);
  });

  it("l'OR complet rend exactement 4 lignes (5 créées, 1 omise) — aucune ligne fantôme, aucune perdue", async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    expect(corps.lignes).toHaveLength(4);
    expect(new Set(corps.lignes.map((l) => l.ligneOrId))).toEqual(
      new Set([
        scenarioA.ligneSommeeDeuxPointages.id,
        scenarioA.ligneEnCoursIgnoree.id,
        scenarioA.ligneBareeeSansPointage.id,
        scenarioA.ligneSansBaremeAvecPointage.id,
      ]),
    );
  });
});

// -------------------------------------------------------------------------------------------
// 404 si l'OR n'existe pas pour ce tenant
// -------------------------------------------------------------------------------------------

describe("404 quand l'OR n'existe pas pour le tenant courant", () => {
  it('un UUID syntaxiquement valide mais inexistant partout rend 404 RESSOURCE_INTROUVABLE', async () => {
    const cookie = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookie, randomUUID());
    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });

  it("l'OR de tenant B, demandé sous une session tenant A, rend le MÊME 404 — pas 403, qui confirmerait son existence", async () => {
    const cookieA = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookieA, orTenantB.id);
    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });

  it("à l'inverse, l'OR de tenant B demandé sous SA PROPRE session tenant B rend bien 200 — contrôle positif", async () => {
    const cookieB = await cookieLecteurPointage(garage.tenantB);
    const reponse = await appelerAgregat(cookieB, orTenantB.id);
    expect(reponse.status).toBe(200);
    expect((reponse.body as { ordreReparationId: string }).ordreReparationId).toBe(orTenantB.id);
  });
});

// -------------------------------------------------------------------------------------------
// Isolation tenant stricte — au-delà du 404 HTTP : aucune fuite même en cas de coïncidence d'id,
// et RLS brut derrière la route.
// -------------------------------------------------------------------------------------------

describe('isolation tenant stricte sur GET /pointages/agregats-ligne', () => {
  it("le total pointé du tenant B (120 sur sa ligne) n'apparaît jamais dans la réponse pour l'OR de tenant A, quand bien même on interrogerait par erreur son propre OR", async () => {
    const cookieA = await cookieLecteurPointage(garage.tenantA);
    const reponse = await appelerAgregat(cookieA, scenarioA.or.id);
    const corps = reponse.body as { lignes: readonly AgregatLigneReponse[] };
    // Aucune ligne de la réponse ne porte le total de tenant B (120) sur une ligne de barème 300 —
    // preuve indirecte qu'aucune ligne de tenant B n'a été mélangée dans l'agrégat de tenant A.
    expect(
      corps.lignes.some((l) => l.tempsBaremeCentiemes === 300 && l.dureePointeeCentiemes === 120),
    ).toBe(false);
  });

  it('SQL brut : les pointages de tenant B sur son propre OR sont invisibles sous le contexte tenant A (RLS, derrière la route)', async () => {
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from pointage where ordre_reparation_id = $1',
      [orTenantB.id],
    );
    expect(lignes).toHaveLength(0);

    const lignesBonTenant = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select * from pointage where ordre_reparation_id = $1',
      [orTenantB.id],
    );
    expect(lignesBonTenant.length).toBeGreaterThan(0);
  });

  it("SQL brut : les lignes d'OR barémées de tenant B sont invisibles sous le contexte tenant A", async () => {
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from ligne_or where ordre_reparation_id = $1',
      [orTenantB.id],
    );
    expect(lignes).toHaveLength(0);
  });
});
