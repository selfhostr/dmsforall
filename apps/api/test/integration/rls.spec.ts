/**
 * Le test le plus important de ce dépôt : preuve que l'isolation tenant tient réellement, au
 * niveau Postgres, pas seulement au niveau applicatif. Tourne sur une vraie base Postgres
 * éphémère (testcontainers), avec les rôles exacts de production (dfa_migrator / dfa_app,
 * NOSUPERUSER, NOBYPASSRLS) — un test RLS qui tournerait en superutilisateur passerait
 * toujours, qu'il y ait une politique ou non derrière, et ne prouverait donc rien.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import {
  LANGUES,
  STATUTS_TENANT,
  STATUTS_UTILISATEUR,
  ROLES_UTILISATEUR,
  TYPES_EVENEMENT_SECURITE,
} from '@dfa/shared';
import { demarrerBaseEphemere, requeteSousTenant, type BaseEphemere } from '../setup/postgres-ephemere';
import { semerGarageDemo, type GarageDemoFixture } from '../fixtures/garage-demo';
import { creerAccesBaseTest, demarrerRedisEphemere, type RedisEphemere } from '../setup/app-test';

let bdd: BaseEphemere;
let demo: GarageDemoFixture;
let redis: RedisEphemere;

beforeAll(async () => {
  bdd = await demarrerBaseEphemere();
  demo = await semerGarageDemo(bdd);
  redis = await demarrerRedisEphemere();
}, 180_000);

afterAll(async () => {
  // Défensif : si `beforeAll` a échoué avant d'initialiser une ressource, `?.` évite de
  // masquer la VRAIE erreur (celle du beforeAll) derrière un TypeError secondaire ici.
  await redis?.fermer();
  await bdd?.fermer();
});

describe('isolation tenant par RLS — lecture et écriture', () => {
  it('sous app.tenant_id = A, "select count(*) from site" ne rend que les sites du tenant A', async () => {
    const lignes = await requeteSousTenant<{ n: string }>(bdd.poolApp, demo.tenantA.id, 'select count(*) as n from site');
    expect(Number(lignes[0]?.n)).toBe(demo.tenantA.sites.length);
  });

  it("un select explicite where id = <site du tenant B> rend zéro ligne sous le contexte du tenant A", async () => {
    const siteDeB = demo.tenantB.sites[0]!;
    const lignes = await requeteSousTenant(bdd.poolApp, demo.tenantA.id, 'select * from site where id = $1', [siteDeB.id]);
    expect(lignes).toHaveLength(0);
  });

  it('sans GUC app.tenant_id positionné, la lecture rend zéro ligne, jamais une erreur (fail-closed)', async () => {
    const lignes = await requeteSousTenant(bdd.poolApp, null, 'select * from site');
    expect(lignes).toHaveLength(0);
  });

  it("un insert portant le tenant_id du tenant B, exécuté sous le contexte du tenant A, viole la politique RLS", async () => {
    await expect(
      requeteSousTenant(
        bdd.poolApp,
        demo.tenantA.id,
        "insert into site (id, tenant_id, code, nom, actif) values ($1, $2, 'INT', 'Site intrus', true)",
        [randomUUID(), demo.tenantB.id],
      ),
    ).rejects.toThrow(/policy|permission/i);
  });

  it('un update qui ferait passer un site du tenant A vers tenant_id = B est refusé par le RLS', async () => {
    const siteDeA = demo.tenantA.sites[0]!;
    await expect(
      requeteSousTenant(bdd.poolApp, demo.tenantA.id, 'update site set tenant_id = $2 where id = $1', [
        siteDeA.id,
        demo.tenantB.id,
      ]),
    ).rejects.toThrow(/policy|permission/i);

    // Le site n'a pas bougé : ni le tenant_id, ni même une écriture partielle quelconque.
    const releve = await requeteSousTenant<{ tenant_id: string }>(
      bdd.poolApp,
      demo.tenantA.id,
      'select tenant_id from site where id = $1',
      [siteDeA.id],
    );
    expect(releve[0]?.tenant_id).toBe(demo.tenantA.id);
  });
});

describe('le piège du pooling — raison d\'être de tout le dispositif', () => {
  it(
    "un set_config posé en portée transaction (is_local=true, le mécanisme documenté pour enTenant) " +
      'disparaît après COMMIT sur la même connexion physique reprise du pool',
    async () => {
      // max:1 force la réutilisation d'une seule et même connexion physique, pour être certain
      // que la seconde requête ci-dessous parle au même socket que la première.
      const pool = new Pool({ connectionString: bdd.app.url, max: 1 });
      try {
        const clientPendantTransaction = await pool.connect();
        let pidConnexionPhysique: number;
        try {
          await clientPendantTransaction.query('begin');
          pidConnexionPhysique = (await clientPendantTransaction.query('select pg_backend_pid() as pid')).rows[0].pid;
          await clientPendantTransaction.query("select set_config('app.tenant_id', $1, true)", [demo.tenantA.id]);
          const pendantLaTransaction = await clientPendantTransaction.query(
            "select current_setting('app.tenant_id', true) as v",
          );
          expect(pendantLaTransaction.rows[0].v).toBe(demo.tenantA.id);
          await clientPendantTransaction.query('commit');
        } finally {
          clientPendantTransaction.release();
        }

        const clientRepriseDuPool = await pool.connect();
        try {
          const pid = (await clientRepriseDuPool.query('select pg_backend_pid() as pid')).rows[0].pid;
          // Précondition du test : si ce n'est pas la même connexion physique, le test ne
          // prouve rien — mieux vaut le faire échouer bruyamment que le laisser passer à tort.
          expect(pid, 'la connexion reprise du pool doit être le même socket physique (max:1)').toBe(
            pidConnexionPhysique,
          );

          const apresCommit = await clientRepriseDuPool.query("select current_setting('app.tenant_id', true) as v");
          expect(apresCommit.rows[0].v === null || apresCommit.rows[0].v === '').toBe(true);
        } finally {
          clientRepriseDuPool.release();
        }
      } finally {
        await pool.end();
      }
    },
  );

  it(
    '(témoin) un set_config posé en portée SESSION (is_local=false) fuit bien vers la connexion ' +
      "suivante du pool — preuve que le test ci-dessus n'est pas vide de sens et détecterait une régression",
    async () => {
      const pool = new Pool({ connectionString: bdd.app.url, max: 1 });
      try {
        const premiereConnexion = await pool.connect();
        try {
          await premiereConnexion.query("select set_config('app.tenant_id', $1, false)", [demo.tenantB.id]);
        } finally {
          premiereConnexion.release();
        }
        const deuxiemeConnexion = await pool.connect();
        try {
          const resultat = await deuxiemeConnexion.query("select current_setting('app.tenant_id', true) as v");
          expect(resultat.rows[0].v).toBe(demo.tenantB.id);
        } finally {
          deuxiemeConnexion.release();
        }
      } finally {
        await pool.end();
      }
    },
  );

  it(
    "l'implémentation réelle AccesBase.enTenant() ne laisse fuiter aucune donnée entre deux tenants " +
      "consécutifs, même sur un pool réduit à une seule connexion physique",
    async () => {
      const { accesBase, fermer } = await creerAccesBaseTest(bdd, redis.url, { DATABASE_POOL_MAX: '1' });
      try {
        for (let iteration = 0; iteration < 5; iteration += 1) {
          const resultatA = await accesBase.enTenant(
            { tenantId: demo.tenantA.id, utilisateurId: null, requeteId: null },
            async (tx) => tx.execute(sql`select count(*)::int as n from site`),
          );
          expect((resultatA as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBe(demo.tenantA.sites.length);

          const resultatB = await accesBase.enTenant(
            { tenantId: demo.tenantB.id, utilisateurId: null, requeteId: null },
            async (tx) => tx.execute(sql`select count(*)::int as n from site`),
          );
          expect((resultatB as unknown as { rows: Array<{ n: number }> }).rows[0]?.n).toBe(demo.tenantB.sites.length);
        }
      } finally {
        await fermer();
      }
    },
  );
});

describe('posture du rôle applicatif dfa_app', () => {
  it("dfa_app n'est ni superutilisateur ni bypassrls, et ne possède aucune table", async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const role = await client.query('select rolsuper, rolbypassrls from pg_roles where rolname = $1', ['dfa_app']);
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });

      const tablesPossedees = await client.query(
        "select count(*)::int as n from pg_tables where schemaname = 'public' and tableowner = 'dfa_app'",
      );
      expect(tablesPossedees.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('dfa_app ne peut pas créer de table (aucun droit CREATE sur le schéma public)', async () => {
    const client = await bdd.poolApp.connect();
    try {
      await expect(client.query('create table t_intrus (x int)')).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });
});

describe('couverture RLS générique — attrape automatiquement toute future table oubliée', () => {
  it('toute table de public portant une colonne tenant_id a relrowsecurity=true et au moins une politique', async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const { rows } = await client.query<{ table_nom: string; rls_actif: boolean; nb_politiques: string }>(`
        select
          c.relname as table_nom,
          c.relrowsecurity as rls_actif,
          (select count(*) from pg_policy p where p.polrelid = c.oid) as nb_politiques
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and exists (
            select 1 from pg_attribute a
            where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
          )
        order by c.relname
      `);

      // Si aucune table n'est trouvée, le test ne PROUVE rien (schéma pas encore migré, ou
      // convention de nommage différente) — on le fait échouer plutôt que passer à tort.
      expect(rows.length, 'aucune table avec colonne tenant_id trouvée — le schéma est-il migré ?').toBeGreaterThan(0);

      for (const ligne of rows) {
        expect.soft(ligne.rls_actif, `${ligne.table_nom}.relrowsecurity doit être true`).toBe(true);
        expect
          .soft(Number(ligne.nb_politiques), `${ligne.table_nom} doit avoir au moins une politique RLS`)
          .toBeGreaterThan(0);
      }
    } finally {
      client.release();
    }
  });

  it("la table tenant elle-même a relrowsecurity=true et une politique (cas particulier documenté : la politique porte sur id, pas tenant_id)", async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const { rows } = await client.query<{ rls_actif: boolean; nb_politiques: string }>(`
        select
          c.relrowsecurity as rls_actif,
          (select count(*) from pg_policy p where p.polrelid = c.oid) as nb_politiques
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = 'tenant' and c.relkind = 'r'
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.rls_actif).toBe(true);
      expect(Number(rows[0]?.nb_politiques)).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });

  // -----------------------------------------------------------------------------------------
  // B4 (rapport QA étape 0) : les deux tests ci-dessus comptent les politiques SANS regarder ce
  // qu'elles filtrent. `using (true) with check (true)` — le motif exact des politiques
  // `tenant_migrator` / `site_migrator` légitimes, à quelques lignes des politiques de dfa_app
  // dans 0001_socle_rls.sql — les satisferait pleinement. Ce test inspecte le CONTENU : pour
  // toute politique qui s'applique à `dfa_app` (explicitement, ou implicitement via un `TO`
  // absent, qui vaut PUBLIC — polroles = '{0}'), USING et WITH CHECK doivent tous deux référencer
  // `tenant_courant()`. Les politiques `dfa_migrator` (using (true) légitime, voir §4 de la
  // migration) sont volontairement exclues : polroles ne contient alors ni 0 (PUBLIC) ni l'oid de
  // dfa_app, donc `vise_dfa_app` est faux pour elles et ce test ne les évalue pas.
  //
  // Preuve que ce test attrape le défaut qu'il vise (menée manuellement pendant le développement,
  // pas conservée ici pour ne pas polluer la suite) : une table temporaire avec une politique
  // `to dfa_app using (true) with check (true)` fait bien rougir ce test, message à l'appui.
  // -----------------------------------------------------------------------------------------
  it("pour toute politique qui s'applique à dfa_app, USING et WITH CHECK référencent tous deux tenant_courant() — jamais using(true)/with check(true)", async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const { rows } = await client.query<{
        table_nom: string;
        politique_nom: string;
        vise_dfa_app: boolean;
        expr_using: string | null;
        expr_with_check: string | null;
      }>(`
        select
          c.relname as table_nom,
          p.polname as politique_nom,
          (
            0 = any(p.polroles)
            or (select oid from pg_roles where rolname = 'dfa_app') = any(p.polroles)
          ) as vise_dfa_app,
          pg_get_expr(p.polqual, p.polrelid)      as expr_using,
          pg_get_expr(p.polwithcheck, p.polrelid) as expr_with_check
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and (
            exists (
              select 1 from pg_attribute a
              where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
            )
            or c.relname = 'tenant'
          )
        order by c.relname, p.polname
      `);

      expect(rows.length, 'aucune politique trouvée — le schéma est-il migré ?').toBeGreaterThan(0);

      const politiquesVisantDfaApp = rows.filter((r) => r.vise_dfa_app);
      expect(
        politiquesVisantDfaApp.length,
        'aucune politique ne vise dfa_app — la frontière de sécurité multi-tenant serait absente',
      ).toBeGreaterThan(0);

      for (const ligne of politiquesVisantDfaApp) {
        expect
          .soft(ligne.expr_using, `${ligne.table_nom}.${ligne.politique_nom} : USING doit référencer tenant_courant()`)
          .toMatch(/tenant_courant\(\)/);
        expect
          .soft(
            ligne.expr_with_check,
            `${ligne.table_nom}.${ligne.politique_nom} : WITH CHECK doit référencer tenant_courant()`,
          )
          .toMatch(/tenant_courant\(\)/);
      }
    } finally {
      client.release();
    }
  });
});

describe('parité des enums Postgres avec les unions TypeScript de @dfa/shared', () => {
  it('les valeurs, et leur ORDRE, correspondent exactement entre chaque enum Postgres et son union TS', async () => {
    const client = await bdd.poolSuperutilisateur.connect();
    try {
      const paires: ReadonlyArray<readonly [string, readonly string[]]> = [
        ['langue', LANGUES],
        ['statut_tenant', STATUTS_TENANT],
        ['statut_utilisateur', STATUTS_UTILISATEUR],
        ['role_utilisateur', ROLES_UTILISATEUR],
        ['type_evenement_securite', TYPES_EVENEMENT_SECURITE],
      ];

      for (const [nomEnumPg, valeursTs] of paires) {
        const { rows } = await client.query<{ valeur: string }>(
          `select e.enumlabel as valeur
           from pg_type t
           join pg_enum e on e.enumtypid = t.oid
           where t.typname = $1
           order by e.enumsortorder`,
          [nomEnumPg],
        );
        expect(rows.length, `enum Postgres "${nomEnumPg}" introuvable`).toBeGreaterThan(0);
        const valeursPg = rows.map((r) => r.valeur);
        expect(valeursPg, `enum Postgres "${nomEnumPg}" vs union TS`).toEqual([...valeursTs]);
      }
    } finally {
      client.release();
    }
  });
});
