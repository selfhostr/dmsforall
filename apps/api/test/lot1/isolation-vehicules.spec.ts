/**
 * Isolation inter-tenant — module VÉHICULES, en exécution, sur vraie base Postgres éphémère.
 *
 * Complète (sans les dupliquer) deux fichiers déjà existants et hors périmètre de cette tâche :
 *   - `test/integration/rls.spec.ts` prouve la POSTURE générique (chaque table `tenant_id` a
 *     `relrowsecurity` + une politique référençant `tenant_courant()`) et le piège du pooling sur
 *     `site`.
 *   - `test/lot1/isolation/isolation-donnees-lot1.spec.ts` couvre `vehicule`/`vehicule_plaque`/
 *     `vehicule_kilometrage` au niveau lecture, mais aucune des 4 tables restantes du module
 *     (`vehicule_detention`, `vehicule_expertise`, `vehicule_campagne`,
 *     `vehicule_travail_reporte`), aucune écriture croisée sur `vehicule` lui-même, et aucun IDOR
 *     HTTP (bloqué à l'époque : les contrôleurs n'existaient pas encore).
 *
 * Ce fichier couvre donc, spécifiquement pour les 7 tables de `0007_vehicules.sql` :
 *   1. lecture croisée table par table (garage-a ne voit jamais une ligne de garage-b) ;
 *   2. écriture croisée — UPDATE ciblant l'UUID d'une ligne de garage-b : zéro ligne affectée,
 *      jamais une erreur trompeuse qui laisserait croire à un succès ;
 *   3. IDOR par l'API réelle : `GET /vehicules/{id}` avec l'UUID d'un véhicule de garage-b,
 *      authentifié comme garage-a, doit répondre 404 RESSOURCE_INTROUVABLE — jamais 403 (qui
 *      confirmerait l'existence de la ressource à un tenant qui n'a pas le droit de le savoir) ;
 *   4. fail-closed : sans `app.tenant_id`, toute lecture rend zéro ligne, jamais une erreur ni
 *      « toutes les lignes » ;
 *   5. posture de `dfa_app` restreinte aux 7 tables du module (NOBYPASSRLS, pas propriétaire,
 *      RLS forcé, politique référençant `tenant_courant()`) ;
 *   6. portée TRANSACTIONNELLE du GUC `app.tenant_id` sur ce module précis, via le vrai chemin
 *      applicatif `AccesBase.enTenant` (pas seulement démontré sur `site`, ailleurs).
 *
 * Nommage des tenants volontairement parlant (garage-a / garage-b) plutôt que t1/t2 — même s'ils
 * sont physiquement `garage.tenantA` / `garage.tenantB` (identifiants hérités de la fixture
 * partagée `garage-demo-lot1.ts`, hors périmètre d'écriture de cette tâche).
 *
 * Chaque assertion de ce fichier est construite pour échouer pour la BONNE raison si la politique
 * RLS correspondante disparaît : les lectures croisées re-basculeraient sur des lignes réelles
 * (jamais un test vide de sens qui resterait vert par construction), et les écritures croisées
 * affecteraient réellement une ligne étrangère au lieu de zéro.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  demarrerBaseEphemere,
  ecrireSousTenant,
  requeteSousTenant,
  type BaseEphemere,
} from '../setup/postgres-ephemere';
import { semerGarageDemoLot1, type GarageDemoLot1Fixture } from './fixtures/garage-demo-lot1';
import { creerAccesBaseTest, creerAppTest, demarrerRedisEphemere, type AppTest, type RedisEphemere } from '../setup/app-test';
import { cookieDeSessionPour } from './isolation-http-aide';

let bdd: BaseEphemere;
let garage: GarageDemoLot1Fixture;
let redis: RedisEphemere;
let ctx: AppTest;

// -------------------------------------------------------------------------------------------
// Données complémentaires : `garage-demo-lot1.ts` (fixture partagée, hors périmètre d'écriture de
// cette tâche) sème `vehicule`/`vehicule_plaque`/`vehicule_detention`/`vehicule_kilometrage` mais
// pas `vehicule_expertise`/`vehicule_campagne`/`vehicule_travail_reporte` — les 3 tables restantes
// du module. On les complète ICI, dans ce fichier, sans toucher à la fixture partagée : chaque
// insertion passe par `ecrireSousTenant` (pool `dfa_app`, sous RLS), exactement le chemin qu'un
// service applicatif emprunterait — amorcer ces lignes EST déjà une preuve que le RLS n'empêche
// pas une écriture légitime sous le bon contexte.
// -------------------------------------------------------------------------------------------

interface LignesComplementaires {
  readonly expertiseId: string;
  readonly campagneId: string;
  readonly travailReporteId: string;
}

async function semerLignesComplementaires(vehiculeId: string, tenantId: string): Promise<LignesComplementaires> {
  const expertiseId = randomUUID();
  const campagneId = randomUUID();
  const travailReporteId = randomUUID();
  await ecrireSousTenant(bdd.poolApp, tenantId, async (client: PoolClient) => {
    await client.query(
      `insert into vehicule_expertise (id, tenant_id, vehicule_id, date_expertise, resultat)
       values ($1, $2, $3, current_date, 'accepte')`,
      [expertiseId, tenantId, vehiculeId],
    );
    await client.query(
      `insert into vehicule_campagne (id, tenant_id, vehicule_id, code)
       values ($1, $2, $3, 'CAMPAGNE-TEST')`,
      [campagneId, tenantId, vehiculeId],
    );
    await client.query(
      `insert into vehicule_travail_reporte (id, tenant_id, vehicule_id, designation, urgence, date_constat)
       values ($1, $2, $3, 'Travail reporté de test', 'a_faire', current_date)`,
      [travailReporteId, tenantId, vehiculeId],
    );
  });
  return { expertiseId, campagneId, travailReporteId };
}

let complA: LignesComplementaires;
let complB: LignesComplementaires;
let plaqueIdA: string;
let plaqueIdB: string;
let detentionIdA: string;
let detentionIdB: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);

  const vehiculeA = garage.tenantA.vehicules[0]!;
  const vehiculeB = garage.tenantB.vehicules[0]!;

  [complA, complB] = await Promise.all([
    semerLignesComplementaires(vehiculeA.id, garage.tenantA.tenant.id),
    semerLignesComplementaires(vehiculeB.id, garage.tenantB.tenant.id),
  ]);

  const [plaqueA, plaqueB, detentionA, detentionB] = await Promise.all([
    requeteSousTenant<{ id: string }>(bdd.poolApp, garage.tenantA.tenant.id, 'select id from vehicule_plaque where vehicule_id = $1', [
      vehiculeA.id,
    ]),
    requeteSousTenant<{ id: string }>(bdd.poolApp, garage.tenantB.tenant.id, 'select id from vehicule_plaque where vehicule_id = $1', [
      vehiculeB.id,
    ]),
    requeteSousTenant<{ id: string }>(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select id from vehicule_detention where vehicule_id = $1',
      [vehiculeA.id],
    ),
    requeteSousTenant<{ id: string }>(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select id from vehicule_detention where vehicule_id = $1',
      [vehiculeB.id],
    ),
  ]);
  plaqueIdA = plaqueA[0]!.id;
  plaqueIdB = plaqueB[0]!.id;
  detentionIdA = detentionA[0]!.id;
  detentionIdB = detentionB[0]!.id;

  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

// -------------------------------------------------------------------------------------------
// 1. Lecture croisée, table par table (les 7 tables de 0007_vehicules.sql)
// -------------------------------------------------------------------------------------------

/** Contrôle positif (la ligne EST visible sous son propre tenant) + assertion d'isolation (elle
 *  est INVISIBLE sous l'autre) dans le même test : un test qui ne vérifierait que la seconde moitié
 *  passerait aussi si la requête ne trouvait jamais rien, ce qui ne prouverait rien du tout. */
async function verifierIsolationLecture(table: string, colonne: string, idPropreA: string, idDeB: string): Promise<void> {
  const propre = await requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, `select * from ${table} where ${colonne} = $1`, [
    idPropreA,
  ]);
  expect(propre.length, `contrôle positif : ${table} de garage-a doit être visible sous son propre contexte`).toBeGreaterThan(0);

  const croise = await requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, `select * from ${table} where ${colonne} = $1`, [
    idDeB,
  ]);
  expect(croise, `${table} de garage-b doit être invisible sous le contexte de garage-a`).toHaveLength(0);
}

describe('lecture croisée — table par table, module véhicules', () => {
  it('vehicule : un véhicule de garage-b est invisible sous le contexte de garage-a', async () => {
    await verifierIsolationLecture('vehicule', 'id', garage.tenantA.vehicules[0]!.id, garage.tenantB.vehicules[0]!.id);
  });

  it('vehicule_plaque : la plaque (courante ou historique) de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('vehicule_plaque', 'id', plaqueIdA, plaqueIdB);
  });

  it('vehicule_detention : le détenteur courant de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('vehicule_detention', 'id', detentionIdA, detentionIdB);
  });

  it('vehicule_kilometrage (append-only) : l\'historique kilométrique de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture(
      'vehicule_kilometrage',
      'vehicule_id',
      garage.tenantA.vehicules[0]!.id,
      garage.tenantB.vehicules[0]!.id,
    );
  });

  it('vehicule_expertise : une expertise de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('vehicule_expertise', 'id', complA.expertiseId, complB.expertiseId);
  });

  it('vehicule_campagne : une campagne constructeur de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('vehicule_campagne', 'id', complA.campagneId, complB.campagneId);
  });

  it('vehicule_travail_reporte : un travail reporté de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('vehicule_travail_reporte', 'id', complA.travailReporteId, complB.travailReporteId);
  });

  it("recherche comptoir par fragment de VIN (normaliser_recherche, RM-112) : le VIN d'un véhicule de garage-b ne se trouve pas sous garage-a", async () => {
    const vehiculeDeB = garage.tenantB.vehicules[0]!;
    const lignes = await requeteSousTenant(
      bdd.poolApp,
      garage.tenantA.tenant.id,
      'select * from vehicule where public.normaliser_recherche(vin) = public.normaliser_recherche($1)',
      [vehiculeDeB.vin],
    );
    expect(lignes).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------
// 2. Absence de contexte tenant = ZÉRO ligne, jamais toutes les lignes (fail-closed)
// -------------------------------------------------------------------------------------------

describe('fail-closed — sans app.tenant_id, aucune lecture ne rend jamais une ligne', () => {
  const TABLES_MODULE_VEHICULES = [
    'vehicule',
    'vehicule_plaque',
    'vehicule_detention',
    'vehicule_kilometrage',
    'vehicule_expertise',
    'vehicule_campagne',
    'vehicule_travail_reporte',
  ] as const;

  it.each(TABLES_MODULE_VEHICULES)('%s : select sans contexte tenant rend zéro ligne, pas une erreur', async (table) => {
    // Précondition du test : au moins UNE ligne existe réellement dans cette table (sur les deux
    // tenants confondus) — sinon "zéro ligne rendue" serait vrai pour une raison sans intérêt
    // (table vide) plutôt que pour la propriété fail-closed qu'on veut prouver.
    const total = await requeteSousTenant<{ n: string }>(bdd.poolApp, garage.tenantA.tenant.id, `select count(*) as n from ${table}`);
    const totalAutre = await requeteSousTenant<{ n: string }>(bdd.poolApp, garage.tenantB.tenant.id, `select count(*) as n from ${table}`);
    const totalCombine = Number(total[0]?.n ?? 0) + Number(totalAutre[0]?.n ?? 0);
    expect(totalCombine, `précondition : ${table} doit contenir au moins une ligne, tous tenants confondus`).toBeGreaterThan(0);

    const lignes = await requeteSousTenant(bdd.poolApp, null, `select * from ${table}`);
    expect(lignes, table).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------
// 3. Écriture croisée — UPDATE ciblant l'UUID d'une ligne de garage-b : zéro ligne affectée,
//    jamais une erreur trompeuse qui laisserait croire à un succès partiel ou total.
// -------------------------------------------------------------------------------------------

/** `returning id` fait porter l'assertion sur le nombre de lignes RÉELLEMENT affectées (pas
 *  seulement "aucune exception") — c'est la seule façon de distinguer un UPDATE qui a
 *  légitimement touché zéro ligne (RLS intact) d'un UPDATE qui aurait réussi silencieusement. */
async function verifierUpdateCroiseSansEffet(table: string, assignation: string, idDeB: string): Promise<void> {
  const lignes = await requeteSousTenant(
    bdd.poolApp,
    garage.tenantA.tenant.id,
    `update ${table} set ${assignation} where id = $1 returning id`,
    [idDeB],
  );
  expect(lignes, `UPDATE sur ${table} ciblant une ligne de garage-b ne doit affecter AUCUNE ligne sous garage-a`).toHaveLength(0);
}

describe('écriture croisée — UPDATE ciblant une ligne de garage-b, sous le contexte de garage-a', () => {
  it("vehicule : renommer la marque d'un véhicule de garage-b n'affecte aucune ligne (RLS USING, pas d'erreur)", async () => {
    await verifierUpdateCroiseSansEffet('vehicule', "marque = 'INTRUS'", garage.tenantB.vehicules[0]!.id);

    // Contrôle positif : le véhicule de garage-b n'a RÉELLEMENT pas changé (relu sous SON tenant).
    const releve = await requeteSousTenant<{ marque: string }>(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select marque from vehicule where id = $1',
      [garage.tenantB.vehicules[0]!.id],
    );
    expect(releve[0]?.marque).toBe(garage.tenantB.vehicules[0]!.marque);
  });

  it("vehicule_plaque : modifier le canton d'une plaque de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('vehicule_plaque', "canton = 'ZZ'", plaqueIdB);
  });

  it("vehicule_detention : modifier le détenteur d'une ligne de garage-b n'affecte aucune ligne", async () => {
    // La valeur assignée n'a pas besoin d'être valide (FK/contrainte) : ZÉRO ligne ne correspond
    // au WHERE (filtré par la politique USING avant même l'évaluation du SET), donc aucune
    // contrainte n'est jamais évaluée — précisément la propriété qu'on vérifie.
    await verifierUpdateCroiseSansEffet('vehicule_detention', `client_id = '${garage.tenantA.clients[0]!.id}'`, detentionIdB);
  });

  it("vehicule_expertise : modifier le résultat d'une expertise de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('vehicule_expertise', "resultat = 'refuse'", complB.expertiseId);
  });

  it("vehicule_campagne : clore une campagne de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('vehicule_campagne', "code = 'INTRUS'", complB.campagneId);
  });

  it("vehicule_travail_reporte : abandonner un travail reporté de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('vehicule_travail_reporte', "designation = 'Intrus'", complB.travailReporteId);
  });
});

describe("écriture croisée — impersonation (WITH CHECK) et suppression, module véhicules", () => {
  it('vehicule : un insert portant tenant_id = garage-b, exécuté sous le contexte de garage-a, viole la politique RLS', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into vehicule (id, tenant_id, marque, modele, statut) values ($1, $2, 'Intrus', 'Intrus', 'actif')`,
        [randomUUID(), garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("vehicule_kilometrage (append-only, INSERT seul accordé) : impersonation refusée, même conclusion que dans isolation-donnees-lot1.spec.ts mais reformulée ici pour garantir que ce fichier reste autonome", async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into vehicule_kilometrage (id, tenant_id, vehicule_id, valeur, unite, releve_le, source)
         values ($1, $2, $3, 1, 'km', now(), 'declaratif')`,
        [randomUUID(), garage.tenantB.tenant.id, garage.tenantA.vehicules[0]!.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it(
    'vehicule : DELETE refusé au niveau PRIVILÈGE (revoke delete, RM-31/Δ6), même sur sa PROPRE ligne — ' +
      'preuve que la suppression d\'une ligne de garage-b est doublement impossible : ni le privilège ' +
      'ni (si le privilège existait) le RLS ne le permettraient',
    async () => {
      await expect(
        requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, 'delete from vehicule where id = $1', [
          garage.tenantA.vehicules[0]!.id,
        ]),
      ).rejects.toThrow(/permission denied/i);
    },
  );

  it('vehicule_kilometrage : UPDATE refusé au niveau PRIVILÈGE (append-only, RM-23) — le mécanisme est plus strict que le RLS seul', async () => {
    await expect(
      requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, "update vehicule_kilometrage set source = 'import' where vehicule_id = $1", [
        garage.tenantA.vehicules[0]!.id,
      ]),
    ).rejects.toThrow(/permission denied/i);
  });
});

// -------------------------------------------------------------------------------------------
// 4. IDOR par l'API réelle — GET /vehicules/{id}
// -------------------------------------------------------------------------------------------

describe('IDOR via HTTP — GET /api/v1/vehicules/{id}', () => {
  it("un véhicule de garage-b, demandé par son UUID réel sous une session garage-a, rend 404 RESSOURCE_INTROUVABLE — jamais 403 (ce qui confirmerait l'existence)", async () => {
    const utilisateurA = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, utilisateurA.email, utilisateurA.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/vehicules/${garage.tenantB.vehicules[0]!.id}`).set('Cookie', cookie);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });

  it("à l'inverse, GET sur SON PROPRE véhicule rend bien 200 — contrôle positif indispensable : sans lui, le 404 ci-dessus pourrait aussi bien signifier une route cassée", async () => {
    const utilisateurA = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, utilisateurA.email, utilisateurA.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/vehicules/${garage.tenantA.vehicules[0]!.id}`).set('Cookie', cookie);

    expect(reponse.status).toBe(200);
    expect((reponse.body as { id?: string }).id).toBe(garage.tenantA.vehicules[0]!.id);
  });

  it('un UUID syntaxiquement valide mais qui n\'existe nulle part (même pas chez garage-b) rend le MÊME 404 — la réponse ne distingue jamais "inexistant" de "chez un autre tenant"', async () => {
    const utilisateurA = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, utilisateurA.email, utilisateurA.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/vehicules/${randomUUID()}`).set('Cookie', cookie);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });
});

// -------------------------------------------------------------------------------------------
// 5. Portée TRANSACTIONNELLE du GUC — via le vrai chemin applicatif AccesBase.enTenant, sur ce
//    module précis (pas seulement démontré sur `site` ailleurs). Un pool réduit à UNE connexion
//    physique (max:1) force la réutilisation du même socket entre deux tenants consécutifs : si
//    `set_config(..., true)` (portée transaction) fuitait vers la connexion suivante recyclée par
//    le pool, garage-b verrait (ou pire, écrirait dans) les données de garage-a.
// -------------------------------------------------------------------------------------------

describe('portée transactionnelle du GUC, module véhicules — le pooling ne fait jamais fuiter un tenant vers le suivant', () => {
  it("cinq allers-retours garage-a / garage-b consécutifs sur `vehicule`, via AccesBase.enTenant, ne mélangent jamais les comptages", async () => {
    const { accesBase, fermer } = await creerAccesBaseTest(bdd, redis.url, { DATABASE_POOL_MAX: '1' });
    try {
      for (let iteration = 0; iteration < 5; iteration += 1) {
        const resultatA = await accesBase.enTenant(
          { tenantId: garage.tenantA.tenant.id, utilisateurId: null, requeteId: null },
          async (tx) => tx.execute(sql`select count(*)::int as n from vehicule`),
        );
        expect((resultatA as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBe(garage.tenantA.vehicules.length);

        const resultatB = await accesBase.enTenant(
          { tenantId: garage.tenantB.tenant.id, utilisateurId: null, requeteId: null },
          async (tx) => tx.execute(sql`select count(*)::int as n from vehicule`),
        );
        expect((resultatB as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBe(garage.tenantB.vehicules.length);
      }
    } finally {
      await fermer();
    }
  });
});

// -------------------------------------------------------------------------------------------
// 6. Posture de dfa_app, restreinte aux 7 tables du module véhicules — si ce rôle gagnait un jour
//    BYPASSRLS ou la propriété d'une de ces tables, TOUS les tests ci-dessus continueraient de
//    passer par ailleurs (ils s'exécutent avec ce même rôle) ; c'est pourquoi la posture elle-même
//    doit être vérifiée, indépendamment du comportement observé.
// -------------------------------------------------------------------------------------------

describe('posture du rôle applicatif dfa_app — module véhicules', () => {
  const TABLES_MODULE_VEHICULES = [
    'vehicule',
    'vehicule_plaque',
    'vehicule_detention',
    'vehicule_kilometrage',
    'vehicule_expertise',
    'vehicule_campagne',
    'vehicule_travail_reporte',
  ] as const;

  it('dfa_app n\'est ni superutilisateur ni BYPASSRLS, et ne possède aucune des 7 tables du module', async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const role = await client.query('select rolsuper, rolbypassrls from pg_roles where rolname = $1', ['dfa_app']);
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

      const { rows } = await client.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' and tableowner = 'dfa_app' and tablename = any($1)`,
        [TABLES_MODULE_VEHICULES],
      );
      expect(rows, 'dfa_app ne doit être propriétaire d\'aucune table du module véhicules').toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('les 7 tables du module véhicules ont relrowsecurity=true (FORCE compris) et une politique référençant tenant_courant()', async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const { rows } = await client.query<{
        table_nom: string;
        rls_actif: boolean;
        rls_force: boolean;
        nb_politiques_conformes: string;
      }>(
        `select
           c.relname as table_nom,
           c.relrowsecurity as rls_actif,
           c.relforcerowsecurity as rls_force,
           (
             select count(*) from pg_policy p
              where p.polrelid = c.oid
                and pg_get_expr(p.polqual, p.polrelid) ~ 'tenant_courant\\(\\)'
                and pg_get_expr(p.polwithcheck, p.polrelid) ~ 'tenant_courant\\(\\)'
           ) as nb_politiques_conformes
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)
        order by c.relname`,
        [TABLES_MODULE_VEHICULES],
      );

      expect(rows, 'les 7 tables du module véhicules doivent exister').toHaveLength(TABLES_MODULE_VEHICULES.length);
      for (const ligne of rows) {
        expect.soft(ligne.rls_actif, `${ligne.table_nom} : relrowsecurity doit être true`).toBe(true);
        expect.soft(ligne.rls_force, `${ligne.table_nom} : relforcerowsecurity doit être true (même le propriétaire est filtré)`).toBe(
          true,
        );
        expect
          .soft(Number(ligne.nb_politiques_conformes), `${ligne.table_nom} : au moins une politique USING+WITH CHECK sur tenant_courant()`)
          .toBeGreaterThan(0);
      }
    } finally {
      client.release();
    }
  });
});
