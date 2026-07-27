/**
 * Implémentation de `AccesBase` — le SEUL point d'entrée vers les tables métier.
 *
 * Trois responsabilités, et rien d'autre :
 *   1. détenir le pool `dfa_app` (jamais exposé) ;
 *   2. ouvrir une transaction en y posant le contexte tenant (`enTenant`) ;
 *   3. refuser le démarrage si la posture RLS de la base n'est pas celle attendue.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { JETON_CONFIG_BASE } from './db.jetons.interne';
import type { AccesBase, BaseDfa, ConfigBase, ContexteTenant, TransactionDfa } from './db.types';
import * as schema from './schema';

/**
 * Tables du socle sur lesquelles `FORCE ROW LEVEL SECURITY` n'est volontairement PAS posé.
 * Le propriétaire doit pouvoir y accéder pour faire fonctionner les fonctions SECURITY DEFINER
 * du schéma `amorcage` — voir la justification détaillée dans 0001_socle_rls.sql §4.
 * Cette liste est la contrepartie applicative de cette exception : toute autre table portant
 * `tenant_id` DOIT être en FORCE, et le démarrage échoue sinon.
 */
const TABLES_SANS_FORCE_RLS: ReadonlySet<string> = new Set([
  'utilisateur',
  'session',
  'journal_securite',
]);

/** Accepte tout UUID canonique, quelle que soit la version. */
const MOTIF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un identifiant de requête est un uuid v4 (§2.9), mais on reste tolérant : il ne sert qu'à tracer. */
const LONGUEUR_MAX_REQUETE_ID = 64;

/** Levée par `verifierPostureRls()`. Porte TOUS les problèmes constatés, pas seulement le premier. */
export class ErreurPostureRls extends Error {
  constructor(readonly problemes: readonly string[]) {
    super(
      `Posture RLS invalide, l'API refuse de démarrer :\n` +
        problemes.map((p) => `  - ${p}`).join('\n') +
        `\nSi la base est vide, appliquer les migrations : pnpm db:migrate`,
    );
    this.name = 'ErreurPostureRls';
  }
}

/**
 * Ligne renvoyée par la requête d'inspection du catalogue.
 * Alias de type et non `interface` : Drizzle contraint le paramètre de `execute<T>` à
 * `Record<string, unknown>`, contrainte qu'un alias satisfait par signature d'index implicite,
 * mais qu'une interface ne satisfait pas.
 */
type PostureTable = {
  table_name: string;
  rls_active: boolean;
  rls_force: boolean;
  porte_tenant_id: boolean;
  politiques_completes: number;
};

@Injectable()
export class ServiceAccesBase implements AccesBase, OnModuleInit, OnModuleDestroy {
  private readonly journal = new Logger(ServiceAccesBase.name);
  private readonly pool: Pool;
  private readonly base: BaseDfa;

  constructor(@Inject(JETON_CONFIG_BASE) private readonly config: ConfigBase) {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: config.DATABASE_POOL_MAX,

      // Visible dans pg_stat_activity : distinguer d'un coup d'œil le trafic applicatif du
      // trafic d'amorçage et des migrations quand on diagnostique un verrou en production.
      application_name: 'dfa-api',

      // Filet côté serveur : une requête qui dépasse ce délai est annulée par PostgreSQL
      // lui-même. Un timeout posé uniquement côté Node laisserait la requête continuer à
      // consommer la base après l'abandon du client.
      statement_timeout: config.DATABASE_TIMEOUT_REQUETE_MS,

      // Une transaction laissée ouverte par un `await` oublié dans un `enTenant` garderait ses
      // verrous ET son GUC indéfiniment. On la tue. Volontairement plus permissif que
      // statement_timeout : une transaction légitime enchaîne plusieurs requêtes.
      idle_in_transaction_session_timeout: config.DATABASE_TIMEOUT_REQUETE_MS * 3,

      connectionTimeoutMillis: 5_000,
    });

    // Sans ce gestionnaire, une erreur sur une connexion INACTIVE du pool (coupure réseau,
    // redémarrage de la base) remonte en `unhandledError` et tue le process Node.
    this.pool.on('error', (erreur) => {
      this.journal.error(`Erreur sur une connexion inactive du pool : ${erreur.message}`);
    });

    this.base = drizzle(this.pool, { schema });
  }

  async onModuleInit(): Promise<void> {
    await this.verifierConnexion();
    await this.verifierPostureRls();
    this.journal.log(
      `Base connectée, posture RLS vérifiée (pool max ${String(this.config.DATABASE_POOL_MAX)}).`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  // -------------------------------------------------------------------------------------------
  // enTenant
  // -------------------------------------------------------------------------------------------

  async enTenant<T>(
    ctx: ContexteTenant,
    travail: (tx: TransactionDfa) => Promise<T>,
  ): Promise<T> {
    // Validation AVANT tout SQL. Les valeurs partent en paramètres liés (aucune concaténation,
    // donc aucune injection possible), mais un tenantId mal formé produirait une erreur de cast
    // à l'intérieur de la transaction, c'est-à-dire un message obscur au lieu d'un refus net.
    // Et surtout : un tenantId vide ferait de `tenant_courant()` un NULL, donc une transaction
    // silencieusement vide au lieu d'un échec.
    if (!MOTIF_UUID.test(ctx.tenantId)) {
      throw new Error(
        `ContexteTenant.tenantId n'est pas un UUID valide. Le tenant se résout depuis la session, jamais depuis une entrée client.`,
      );
    }
    if (ctx.utilisateurId !== null && !MOTIF_UUID.test(ctx.utilisateurId)) {
      throw new Error(`ContexteTenant.utilisateurId n'est ni null ni un UUID valide.`);
    }
    if (ctx.requeteId !== null && ctx.requeteId.length > LONGUEUR_MAX_REQUETE_ID) {
      throw new Error(`ContexteTenant.requeteId dépasse ${String(LONGUEUR_MAX_REQUETE_ID)} caractères.`);
    }

    return this.base.transaction(async (tx) => {
      // 3e argument `true` = portée TRANSACTION. C'est le cœur du dispositif : PostgreSQL
      // réinitialise ces paramètres au COMMIT comme au ROLLBACK, donc la connexion rendue au
      // pool ne conserve aucun tenant. Avec une portée session, une connexion recyclée
      // transporterait le tenant du client précédent — fuite non déterministe, invisible en
      // test unitaire, impossible à reproduire.
      //
      // `?? ''` plutôt que NULL : le contrat de `tenant_courant()` est de traiter la chaîne
      // vide comme « absent » (nullif). On lui donne exactement ce qu'il attend.
      await tx.execute(sql`
        select set_config('app.tenant_id',      ${ctx.tenantId},            true),
               set_config('app.utilisateur_id', ${ctx.utilisateurId ?? ''}, true),
               set_config('app.requete_id',     ${ctx.requeteId ?? ''},     true)
      `);

      return travail(tx);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Sondes
  // -------------------------------------------------------------------------------------------

  async verifierConnexion(): Promise<void> {
    await this.base.execute(sql`select 1`);
  }

  async verifierPostureRls(): Promise<void> {
    const problemes: string[] = [];

    // --- 1. Attributs du rôle de connexion -----------------------------------------------------
    // Un superuser ou un rôle BYPASSRLS ignore SILENCIEUSEMENT toutes les politiques. Toute la
    // suite du dispositif serait décorative.
    const roles = await this.base.execute<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(sql`
      select r.rolname, r.rolsuper, r.rolbypassrls
        from pg_catalog.pg_roles r
       where r.rolname = current_user
    `);

    const role = roles.rows[0];
    if (role === undefined) {
      problemes.push(`impossible de lire les attributs du rôle courant dans pg_roles`);
    } else {
      if (role.rolsuper) {
        problemes.push(
          `le rôle « ${role.rolname} » est SUPERUSER : il contourne toutes les politiques RLS. L'API doit se connecter avec dfa_app (DATABASE_URL).`,
        );
      }
      if (role.rolbypassrls) {
        problemes.push(
          `le rôle « ${role.rolname} » a l'attribut BYPASSRLS : il contourne toutes les politiques RLS.`,
        );
      }
    }

    // --- 2. Propriété des tables ---------------------------------------------------------------
    // Le propriétaire s'affranchit du RLS partout où FORCE n'est pas posé — c'est-à-dire, chez
    // nous, sur utilisateur, session et journal_securite. Si l'API tournait avec dfa_migrator,
    // elle lirait tous les comptes de tous les tenants sans qu'aucune erreur ne se produise.
    const possedees = await this.base.execute<{ relname: string }>(sql`
      select c.relname
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and c.relowner = (select oid from pg_catalog.pg_roles where rolname = current_user)
       order by c.relname
    `);

    if (possedees.rows.length > 0) {
      const noms = possedees.rows.map((l) => l.relname).join(', ');
      problemes.push(
        `le rôle courant est propriétaire de tables du schéma public (${noms}) : sans FORCE, un propriétaire ignore les politiques RLS. L'API doit utiliser dfa_app, jamais dfa_migrator.`,
      );
    }

    // --- 3. Posture table par table ------------------------------------------------------------
    const tables = await this.base.execute<PostureTable>(sql`
      select c.relname                                  as table_name,
             c.relrowsecurity                           as rls_active,
             c.relforcerowsecurity                      as rls_force,
             exists (
               select 1
                 from pg_catalog.pg_attribute a
                where a.attrelid = c.oid
                  and a.attname  = 'tenant_id'
                  and a.attnum   > 0
                  and not a.attisdropped
             )                                          as porte_tenant_id,
             (
               select count(*)
                 from pg_catalog.pg_policy p
                where p.polrelid    = c.oid
                  -- USING **et** WITH CHECK. Une politique sans WITH CHECK laisse un INSERT
                  -- écrire le tenant_id d'autrui, et un UPDATE déplacer une ligne vers un
                  -- autre tenant : la ligne disparaît alors de la vue de son auteur, ce qui
                  -- rend la corruption indétectable côté application.
                  and p.polqual     is not null
                  and p.polwithcheck is not null
                  and (
                    p.polroles = '{0}'::oid[]
                    or (select oid from pg_catalog.pg_roles where rolname = current_user)
                       = any (p.polroles)
                  )
             )::int                                     as politiques_completes
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
       order by c.relname
    `);

    if (tables.rows.length === 0) {
      problemes.push(
        `aucune table dans le schéma public : les migrations n'ont pas été appliquées sur cette base`,
      );
    }

    for (const t of tables.rows) {
      if (!t.rls_active) {
        problemes.push(`table « ${t.table_name} » : ROW LEVEL SECURITY non activé`);
        continue;
      }

      // La table `tenant` s'isole sur `id` et non sur `tenant_id` : elle est son propre tenant.
      const doitEtreIsolee = t.porte_tenant_id || t.table_name === 'tenant';
      if (!doitEtreIsolee) {
        continue;
      }

      if (t.politiques_completes < 1) {
        problemes.push(
          `table « ${t.table_name} » : aucune politique complète (USING + WITH CHECK) applicable au rôle courant`,
        );
      }

      if (!t.rls_force && !TABLES_SANS_FORCE_RLS.has(t.table_name)) {
        problemes.push(
          `table « ${t.table_name} » : FORCE ROW LEVEL SECURITY manquant (exception admise uniquement pour ${[...TABLES_SANS_FORCE_RLS].join(', ')})`,
        );
      }
    }

    if (problemes.length > 0) {
      throw new ErreurPostureRls(problemes);
    }
  }
}
