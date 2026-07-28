/**
 * Isolation inter-tenant — module PARAMÉTRAGE, en exécution, sur vraie base Postgres éphémère.
 *
 * Couvre les 9 tables de `0005_parametrage.sql` : `parametre_atelier` (singleton par tenant, PK =
 * `tenant_id`), `parametre_site` (singleton par site, PK = `site_id`), `compteur_document`,
 * `taux_horaire`, `prestation`, `prestation_prix`, `motif_rendez_vous`, `poste_travail`,
 * `activite_indirecte`. Aucune fixture partagée n'amorce ces tables (`garage-demo-lot1.ts` — hors
 * périmètre d'écriture de cette tâche — se concentre sur clients/véhicules/OR) : ce fichier sème
 * ses propres données, sous RLS (`ecrireSousTenant`, pool `dfa_app`), pour les deux tenants de
 * `garage-demo-lot1.ts`.
 *
 * Mêmes 6 propriétés que `isolation-vehicules.spec.ts` (voir son en-tête pour le détail de la
 * méthode) : lecture croisée table par table, écriture croisée sans erreur trompeuse, IDOR HTTP,
 * fail-closed, posture de `dfa_app`, portée transactionnelle du GUC — appliquées ici au module
 * paramétrage.
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

interface DonneesParametrageTenant {
  readonly compteurDocumentId: string;
  readonly tauxHoraireId: string;
  readonly prestationId: string;
  readonly prestationPrixId: string;
  readonly motifRendezVousId: string;
  readonly posteTravailId: string;
  readonly activiteIndirecteId: string;
}

async function semerDonneesParametrage(tenantId: string, siteId: string, prefixeCode: string): Promise<DonneesParametrageTenant> {
  const compteurDocumentId = randomUUID();
  const tauxHoraireId = randomUUID();
  const prestationId = randomUUID();
  const prestationPrixId = randomUUID();
  const motifRendezVousId = randomUUID();
  const posteTravailId = randomUUID();
  const activiteIndirecteId = randomUUID();

  await ecrireSousTenant(bdd.poolApp, tenantId, async (client: PoolClient) => {
    // Singletons — une seule ligne par tenant / par site, PK confondue avec tenant_id / site_id
    // (0005_parametrage.sql §2 et §3). Amorcés ici : la fixture partagée ne les crée pas.
    await client.query(`insert into parametre_atelier (tenant_id) values ($1)`, [tenantId]);
    await client.query(`insert into parametre_site (tenant_id, site_id) values ($1, $2)`, [tenantId, siteId]);

    await client.query(
      `insert into compteur_document (id, tenant_id, type_document, annee, site_id, valeur)
       values ($1, $2, 'or', 2026, $3, 3)`,
      [compteurDocumentId, tenantId, siteId],
    );

    await client.query(
      `insert into taux_horaire (id, tenant_id, code, libelle, montant_centimes, valide_du)
       values ($1, $2, $3, 'Taux standard atelier', 14500, current_date - interval '1 year')`,
      [tauxHoraireId, tenantId, `${prefixeCode}-STD`],
    );

    await client.query(
      `insert into prestation (id, tenant_id, code, designation_fr) values ($1, $2, $3, 'Forfait révision standard')`,
      [prestationId, tenantId, `${prefixeCode}-FORFAIT`],
    );
    await client.query(
      `insert into prestation_prix (id, tenant_id, prestation_id, prix_centimes, valide_du)
       values ($1, $2, $3, 25000, current_date - interval '1 year')`,
      [prestationPrixId, tenantId, prestationId],
    );

    await client.query(
      `insert into motif_rendez_vous (id, tenant_id, code, libelle_fr) values ($1, $2, $3, 'Contrôle périodique')`,
      [motifRendezVousId, tenantId, `${prefixeCode}-CTRL`],
    );
    await client.query(
      `insert into poste_travail (id, tenant_id, site_id, code, libelle) values ($1, $2, $3, $4, 'Pont 1')`,
      [posteTravailId, tenantId, siteId, `${prefixeCode}-P1`],
    );
    await client.query(
      `insert into activite_indirecte (id, tenant_id, code, libelle_fr) values ($1, $2, $3, 'Nettoyage atelier')`,
      [activiteIndirecteId, tenantId, `${prefixeCode}-NETT`],
    );
  });

  return { compteurDocumentId, tauxHoraireId, prestationId, prestationPrixId, motifRendezVousId, posteTravailId, activiteIndirecteId };
}

let donneesA: DonneesParametrageTenant;
let donneesB: DonneesParametrageTenant;
let siteIdA: string;
let siteIdB: string;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  garage = await semerGarageDemoLot1(bdd);

  siteIdA = garage.tenantA.tenant.sites[0]!.id;
  siteIdB = garage.tenantB.tenant.sites[0]!.id;

  [donneesA, donneesB] = await Promise.all([
    semerDonneesParametrage(garage.tenantA.tenant.id, siteIdA, 'GA'),
    semerDonneesParametrage(garage.tenantB.tenant.id, siteIdB, 'GB'),
  ]);

  redis = await demarrerRedisEphemere();
  ctx = await creerAppTest(bdd, redis.url);
}, 180_000);

afterAll(async () => {
  await ctx?.fermer();
  await redis?.fermer();
  await bdd?.fermer();
});

// -------------------------------------------------------------------------------------------
// 1. Lecture croisée, table par table
// -------------------------------------------------------------------------------------------

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

describe('lecture croisée — table par table, module paramétrage', () => {
  it('parametre_atelier : le singleton de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('parametre_atelier', 'tenant_id', garage.tenantA.tenant.id, garage.tenantB.tenant.id);
  });

  it('parametre_site : les paramètres du site de garage-b sont invisibles sous garage-a', async () => {
    await verifierIsolationLecture('parametre_site', 'site_id', siteIdA, siteIdB);
  });

  it('compteur_document : le compteur de numérotation de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('compteur_document', 'id', donneesA.compteurDocumentId, donneesB.compteurDocumentId);
  });

  it('taux_horaire : un taux horaire de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('taux_horaire', 'id', donneesA.tauxHoraireId, donneesB.tauxHoraireId);
  });

  it('prestation : une prestation du catalogue de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('prestation', 'id', donneesA.prestationId, donneesB.prestationId);
  });

  it('prestation_prix : un prix daté de prestation de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('prestation_prix', 'id', donneesA.prestationPrixId, donneesB.prestationPrixId);
  });

  it('motif_rendez_vous : un motif de RDV de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('motif_rendez_vous', 'id', donneesA.motifRendezVousId, donneesB.motifRendezVousId);
  });

  it('poste_travail : un poste de travail de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('poste_travail', 'id', donneesA.posteTravailId, donneesB.posteTravailId);
  });

  it('activite_indirecte : une activité indirecte de garage-b est invisible sous garage-a', async () => {
    await verifierIsolationLecture('activite_indirecte', 'id', donneesA.activiteIndirecteId, donneesB.activiteIndirecteId);
  });
});

// -------------------------------------------------------------------------------------------
// 2. Fail-closed
// -------------------------------------------------------------------------------------------

describe('fail-closed — sans app.tenant_id, aucune lecture ne rend jamais une ligne', () => {
  const TABLES_MODULE_PARAMETRAGE = [
    'parametre_atelier',
    'parametre_site',
    'compteur_document',
    'taux_horaire',
    'prestation',
    'prestation_prix',
    'motif_rendez_vous',
    'poste_travail',
    'activite_indirecte',
  ] as const;

  it.each(TABLES_MODULE_PARAMETRAGE)('%s : select sans contexte tenant rend zéro ligne, pas une erreur', async (table) => {
    const totalA = await requeteSousTenant<{ n: string }>(bdd.poolApp, garage.tenantA.tenant.id, `select count(*) as n from ${table}`);
    const totalB = await requeteSousTenant<{ n: string }>(bdd.poolApp, garage.tenantB.tenant.id, `select count(*) as n from ${table}`);
    const totalCombine = Number(totalA[0]?.n ?? 0) + Number(totalB[0]?.n ?? 0);
    expect(totalCombine, `précondition : ${table} doit contenir au moins une ligne, tous tenants confondus`).toBeGreaterThan(0);

    const lignes = await requeteSousTenant(bdd.poolApp, null, `select * from ${table}`);
    expect(lignes, table).toHaveLength(0);
  });
});

// -------------------------------------------------------------------------------------------
// 3. Écriture croisée
// -------------------------------------------------------------------------------------------

async function verifierUpdateCroiseSansEffet(table: string, colonneId: string, assignation: string, idDeB: string): Promise<void> {
  const lignes = await requeteSousTenant(
    bdd.poolApp,
    garage.tenantA.tenant.id,
    `update ${table} set ${assignation} where ${colonneId} = $1 returning ${colonneId}`,
    [idDeB],
  );
  expect(lignes, `UPDATE sur ${table} ciblant une ligne de garage-b ne doit affecter AUCUNE ligne sous garage-a`).toHaveLength(0);
}

describe('écriture croisée — UPDATE ciblant une ligne de garage-b, sous le contexte de garage-a', () => {
  it("parametre_atelier : modifier le singleton de garage-b (visé par tenant_id) n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('parametre_atelier', 'tenant_id', "or_prefixe = 'INTRUS'", garage.tenantB.tenant.id);
  });

  it("parametre_site : modifier les paramètres du site de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('parametre_site', 'site_id', "heure_ouverture = '06:00'", siteIdB);
  });

  it("taux_horaire : modifier le montant d'un taux de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('taux_horaire', 'id', 'montant_centimes = 1', donneesB.tauxHoraireId);

    // Contrôle positif : le taux de garage-b n'a réellement pas bougé (relu sous SON tenant).
    const releve = await requeteSousTenant<{ montant_centimes: number }>(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select montant_centimes from taux_horaire where id = $1',
      [donneesB.tauxHoraireId],
    );
    expect(releve[0]?.montant_centimes).toBe(14500);
  });

  it("prestation : modifier une prestation de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('prestation', 'id', "designation_fr = 'Intrus'", donneesB.prestationId);
  });

  it("motif_rendez_vous : modifier un motif de RDV de garage-b n'affecte aucune ligne", async () => {
    await verifierUpdateCroiseSansEffet('motif_rendez_vous', 'id', "libelle_fr = 'Intrus'", donneesB.motifRendezVousId);
  });
});

describe("écriture croisée — impersonation (WITH CHECK) et suppression, module paramétrage", () => {
  it('taux_horaire : un insert portant tenant_id = garage-b, exécuté sous le contexte de garage-a, viole la politique RLS', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into taux_horaire (id, tenant_id, code, libelle, montant_centimes, valide_du)
         values ($1, $2, 'GA-INTRUS', 'Intrus', 100, current_date)`,
        [randomUUID(), garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('prestation : un insert portant tenant_id = garage-b, exécuté sous le contexte de garage-a, viole la politique RLS', async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        garage.tenantA.tenant.id,
        `insert into prestation (id, tenant_id, code, designation_fr) values ($1, $2, 'GA-INTRUS', 'Intrus')`,
        [randomUUID(), garage.tenantB.tenant.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it("taux_horaire : DELETE refusé au niveau PRIVILÈGE (revoke delete, Δ6), même sur sa PROPRE ligne", async () => {
    await expect(
      requeteSousTenant(bdd.poolApp, garage.tenantA.tenant.id, 'delete from taux_horaire where id = $1', [donneesA.tauxHoraireId]),
    ).rejects.toThrow(/permission denied/i);
  });
});

// -------------------------------------------------------------------------------------------
// 4. IDOR via l'API réelle
// -------------------------------------------------------------------------------------------

describe('IDOR via HTTP — PATCH /api/v1/referentiels/taux-horaires/{id}', () => {
  it("un taux horaire de garage-b, PATCHé par son UUID réel sous une session garage-a, rend 404 RESSOURCE_INTROUVABLE — jamais 403", async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);

    const reponse = await ctx.requete
      .patch(`/api/v1/referentiels/taux-horaires/${donneesB.tauxHoraireId}`)
      .set('Cookie', cookie)
      // PATCH est une méthode mutante : GardeSession exige un `Origin` conforme à
      // WEB_URL_PUBLIQUE avant même d'évaluer les droits (voir auth/garde-session.ts), sans quoi
      // la requête échoue 403 AUTH_ORIGINE_REFUSEE — un faux négatif qui n'aurait rien à voir avec
      // l'isolation tenant qu'on cherche à prouver ici.
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .send({ libelle: 'Tentative IDOR' });

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');

    // Contrôle positif que la ressource CIBLÉE existe bel et bien (chez garage-b) : le 404 vient
    // bien de l'isolation, pas d'un UUID qui ne correspond à rien nulle part.
    const releve = await requeteSousTenant<{ libelle: string }>(
      bdd.poolApp,
      garage.tenantB.tenant.id,
      'select libelle from taux_horaire where id = $1',
      [donneesB.tauxHoraireId],
    );
    expect(releve[0]?.libelle).not.toBe('Tentative IDOR');
  });

  it("à l'inverse, PATCH sur SON PROPRE taux horaire rend bien 200", async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);

    const reponse = await ctx.requete
      .patch(`/api/v1/referentiels/taux-horaires/${donneesA.tauxHoraireId}`)
      .set('Cookie', cookie)
      .set('Origin', ctx.config.WEB_URL_PUBLIQUE)
      .send({ libelle: 'Taux standard atelier (révisé)' });

    expect(reponse.status).toBe(200);
  });
});

describe('IDOR via HTTP — GET /api/v1/sites/{id}/parametres-atelier', () => {
  it("les paramètres du site de garage-b, demandés par son UUID réel sous une session garage-a, rendent 404 — jamais 403", async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/sites/${siteIdB}/parametres-atelier`).set('Cookie', cookie);

    expect(reponse.status).toBe(404);
    expect((reponse.body as { code?: string }).code).toBe('RESSOURCE_INTROUVABLE');
  });

  it("à l'inverse, GET sur les paramètres de SON PROPRE site rend bien 200", async () => {
    const admin = garage.tenantA.utilisateursParRole.admin;
    const cookie = await cookieDeSessionPour(ctx, admin.email, admin.motDePasseClair);

    const reponse = await ctx.requete.get(`/api/v1/sites/${siteIdA}/parametres-atelier`).set('Cookie', cookie);

    expect(reponse.status).toBe(200);
  });
});

// -------------------------------------------------------------------------------------------
// 5. Portée transactionnelle du GUC
// -------------------------------------------------------------------------------------------

describe('portée transactionnelle du GUC, module paramétrage', () => {
  it("cinq allers-retours garage-a / garage-b consécutifs sur `taux_horaire`, via AccesBase.enTenant, ne mélangent jamais les comptages", async () => {
    const { accesBase, fermer } = await creerAccesBaseTest(bdd, redis.url, { DATABASE_POOL_MAX: '1' });
    try {
      for (let iteration = 0; iteration < 5; iteration += 1) {
        const resultatA = await accesBase.enTenant(
          { tenantId: garage.tenantA.tenant.id, utilisateurId: null, requeteId: null },
          async (tx) => tx.execute(sql`select count(*)::int as n from taux_horaire`),
        );
        expect((resultatA as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBe(1);

        const resultatB = await accesBase.enTenant(
          { tenantId: garage.tenantB.tenant.id, utilisateurId: null, requeteId: null },
          async (tx) => tx.execute(sql`select count(*)::int as n from taux_horaire`),
        );
        expect((resultatB as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBe(1);
      }
    } finally {
      await fermer();
    }
  });
});

// -------------------------------------------------------------------------------------------
// 6. Posture de dfa_app, restreinte aux 9 tables du module paramétrage
// -------------------------------------------------------------------------------------------

describe('posture du rôle applicatif dfa_app — module paramétrage', () => {
  const TABLES_MODULE_PARAMETRAGE = [
    'parametre_atelier',
    'parametre_site',
    'compteur_document',
    'taux_horaire',
    'prestation',
    'prestation_prix',
    'motif_rendez_vous',
    'poste_travail',
    'activite_indirecte',
  ] as const;

  it('dfa_app n\'est ni superutilisateur ni BYPASSRLS, et ne possède aucune des 9 tables du module', async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const role = await client.query('select rolsuper, rolbypassrls from pg_roles where rolname = $1', ['dfa_app']);
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

      const { rows } = await client.query<{ tablename: string }>(
        `select tablename from pg_tables where schemaname = 'public' and tableowner = 'dfa_app' and tablename = any($1)`,
        [TABLES_MODULE_PARAMETRAGE],
      );
      expect(rows, 'dfa_app ne doit être propriétaire d\'aucune table du module paramétrage').toHaveLength(0);
    } finally {
      client.release();
    }
  });

  it('les 9 tables du module paramétrage ont relrowsecurity=true (FORCE compris) et une politique référençant tenant_courant()', async () => {
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
        [TABLES_MODULE_PARAMETRAGE],
      );

      expect(rows, 'les 9 tables du module paramétrage doivent exister').toHaveLength(TABLES_MODULE_PARAMETRAGE.length);
      for (const ligne of rows) {
        expect.soft(ligne.rls_actif, `${ligne.table_nom} : relrowsecurity doit être true`).toBe(true);
        expect.soft(ligne.rls_force, `${ligne.table_nom} : relforcerowsecurity doit être true`).toBe(true);
        expect
          .soft(Number(ligne.nb_politiques_conformes), `${ligne.table_nom} : au moins une politique USING+WITH CHECK sur tenant_courant()`)
          .toBeGreaterThan(0);
      }
    } finally {
      client.release();
    }
  });
});
