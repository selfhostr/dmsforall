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

import { estErreurEpuisementPool, traduireErreurPoolSature } from './erreur-pool-sature';
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

// -----------------------------------------------------------------------------------------------
// Marqueurs de posture déclarée (voir migrations/0002_posture_declaree.sql)
//
// Une table qui déroge au motif standard le DÉCLARE dans son commentaire (`comment on table`),
// dans la même migration que son `create table`. Le contrôle ci-dessous ne fait jamais confiance
// à la déclaration seule : il vérifie qu'elle correspond aux privilèges réellement détenus par le
// rôle de connexion. Déclarer ne donne donc aucun droit — cela décrit une posture, et une posture
// qui ne se vérifie pas fait échouer le démarrage malgré la déclaration.
//
// Pourquoi le commentaire de table plutôt qu'une liste blanche en TypeScript : poser un
// commentaire exige d'être propriétaire de la table, donc dfa_migrator. dfa_app ne peut pas
// s'auto-déclarer une exception. Et la déclaration vit dans la base, pas dans un fichier qui peut
// diverger de la base qu'il prétend décrire.
// -----------------------------------------------------------------------------------------------

/** Table sans `tenant_id`, identique pour tous les tenants. Exigé : dfa_app y a SELECT et rien d'autre. */
export const MARQUEUR_REFERENTIEL = 'dfa:referentiel-partage';

/** Table sans `tenant_id` hors d'atteinte de l'application. Exigé : dfa_app n'y a AUCUN privilège. */
export const MARQUEUR_HORS_PORTEE = 'dfa:hors-portee-app';

/** dfa_app a le droit de supprimer physiquement des lignes. Sans ce marqueur, DELETE est refusé. */
export const MARQUEUR_SUPPRESSION = 'dfa:suppression-physique';

const MARQUEURS_CONNUS: ReadonlySet<string> = new Set([
  MARQUEUR_REFERENTIEL,
  MARQUEUR_HORS_PORTEE,
  MARQUEUR_SUPPRESSION,
]);

/**
 * Grammaire d'un marqueur : `[dfa:motif-en-minuscules]`, n'importe où dans le commentaire.
 *
 * Volontairement PERMISSIF à la capture (tout ce qui n'est ni espace ni crochet fermant) et
 * STRICT à la validation, contre `MARQUEURS_CONNUS`. Un motif restreint à `[a-z0-9-]` ne
 * reconnaîtrait pas `[dfa:referentiel_partage]` ni `[dfa:Referentiel-Partage]` : la coquille
 * passerait pour une absence de marqueur au lieu d'un refus nommé, et l'auteur chercherait
 * longtemps. Le drapeau `i` sert le même but — reconnaître pour refuser, pas pour accepter.
 */
const MOTIF_MARQUEUR = /\[(dfa:[^\]\s]+)\]/gi;

/**
 * Longueur minimale de la justification en clair exigée à côté d'un marqueur.
 * Un `comment on table x is '[dfa:referentiel-partage]'` posé à la va-vite doit être refusé :
 * l'intérêt d'une exception déclarée est qu'elle porte la raison, relisible sans archéologie git.
 */
const LONGUEUR_MIN_JUSTIFICATION = 15;

/** Marqueurs extraits d'un commentaire de table, avec ce qui reste une fois retirés. */
export interface DeclarationPosture {
  readonly marqueurs: ReadonlySet<string>;
  /** Marqueurs `[dfa:…]` qui ne figurent pas au vocabulaire — typiquement une faute de frappe. */
  readonly inconnus: readonly string[];
  /** Texte hors marqueurs, normalisé. Sert à exiger une justification. */
  readonly justification: string;
}

/**
 * Analyse le commentaire d'une table. Séparée pour être testable telle quelle : c'est le point où
 * une faute de frappe (`[dfa:referentiel_partage]`) doit devenir un refus bruyant et non une
 * déclaration silencieusement absente.
 */
export function lireDeclaration(commentaire: string | null): DeclarationPosture {
  if (commentaire === null || commentaire.trim() === '') {
    return { marqueurs: new Set(), inconnus: [], justification: '' };
  }

  const marqueurs = new Set<string>();
  const inconnus: string[] = [];

  for (const trouve of commentaire.matchAll(MOTIF_MARQUEUR)) {
    const nom = trouve[1] ?? '';
    if (MARQUEURS_CONNUS.has(nom)) {
      marqueurs.add(nom);
    } else {
      inconnus.push(nom);
    }
  }

  // Les marqueurs inconnus sont retirés eux aussi : sinon un `[dfa:typo]` compterait comme
  // justification, ce qui reviendrait à récompenser la faute de frappe.
  const justification = commentaire.replace(MOTIF_MARQUEUR, ' ').replace(/\s+/g, ' ').trim();

  return { marqueurs, inconnus, justification };
}

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
export type PostureTable = {
  table_name: string;
  rls_active: boolean;
  rls_force: boolean;
  porte_tenant_id: boolean;
  /** Politiques permissives dont USING **et** WITH CHECK passent par `tenant_courant()`. */
  politiques_isolantes: number;
  /** Politiques permissives dont une expression PRÉSENTE n'appelle pas `tenant_courant()`. */
  politiques_non_isolantes: string[];
  /** Toutes les politiques permissives applicables, décrites — sert à rendre l'erreur lisible. */
  inventaire_politiques: string[];
  /** `comment on table` — porte les marqueurs de posture déclarée. */
  commentaire: string | null;
  /**
   * Privilèges EFFECTIFS du rôle de connexion (héritages de rôles et privilèges PUBLIC compris).
   * On lit ce que le rôle peut faire, pas ce qu'un GRANT nominatif lui a donné : ce sont deux
   * choses différentes, et seule la première est une propriété de sécurité.
   */
  peut_selectionner: boolean;
  peut_inserer: boolean;
  peut_modifier: boolean;
  peut_supprimer: boolean;
  peut_tronquer: boolean;
  /**
   * `true` si cette table est une PARTITION d'une autre. Vérifié en exécution : une partition
   * n'hérite ni de `relrowsecurity`, ni de `FORCE`, ni des politiques de sa table mère — mais
   * elle hérite bien des privilèges, que les `default privileges` lui accordent à la création.
   */
  est_partition: boolean;
  /** Table mère, si `est_partition`. Sert à rendre le diagnostic actionnable. */
  table_mere: string | null;
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

      // Connexions maintenues ouvertes même hors trafic — voir la justification complète sur
      // `DATABASE_POOL_MIN` dans `config/charger-config.ts`. Sans ce réglage (`min` par défaut à
      // 0 côté `pg-pool`), le pool se vide entièrement après `DATABASE_TIMEOUT_IDLE_MS`
      // d'inactivité, et la salve de requêtes suivante paie le coût plein d'un nouveau handshake
      // TCP + authentification SCRAM par connexion — c'est ce scénario, pas une fuite de
      // connexions (vérifié, voir le rapport d'investigation), qui a produit l'essentiel des
      // `timeout exceeded when trying to connect` mesurés sous charge.
      min: config.DATABASE_POOL_MIN,

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

      // Auparavant câblé en dur (`5_000`), jamais validé ni ajustable par déploiement — voir la
      // justification du défaut (inchangé) sur `DATABASE_TIMEOUT_CONNEXION_MS`,
      // `config/charger-config.ts`.
      connectionTimeoutMillis: config.DATABASE_TIMEOUT_CONNEXION_MS,

      // Auparavant implicite (défaut `pg-pool` = 10 000 ms, invisible à la relecture de ce
      // fichier) — voir la justification du nouveau défaut (30 000 ms) sur
      // `DATABASE_TIMEOUT_IDLE_MS`, `config/charger-config.ts`.
      idleTimeoutMillis: config.DATABASE_TIMEOUT_IDLE_MS,
    });

    // Sans ce gestionnaire, une erreur sur une connexion INACTIVE du pool (coupure réseau,
    // redémarrage de la base) remonte en `unhandledError` et tue le process Node.
    this.pool.on('error', (erreur) => {
      this.journal.error(`Erreur sur une connexion inactive du pool : ${erreur.message}`);
    });

    // TROU DISTINCT du gestionnaire ci-dessus, comblé ici — défaut réel du 26.08.2026, reproduit
    // en exécution (import de reprise, archive Auto-i complète de @laupernoe) : `pool.on('error', ...)`
    // ne couvre QUE les connexions INACTIVES DANS LE POOL. Dès qu'une connexion est retirée du
    // pool pour une transaction (`pg-pool/index.js::_acquireClient`), `pg-pool` détache SA PROPRE
    // écoute `error` de ce client précis — ré-attachée seulement à la RELEASE — pour laisser
    // l'appelant (nous) responsable des erreurs PENDANT l'usage actif. Si PostgreSQL termine
    // cette connexion pendant qu'AUCUNE requête n'est en vol dessus (`idle_in_transaction_
    // session_timeout` ci-dessus, ex. un `await tx.execute(...)` qui tarde à être RELANCÉ côté
    // JS entre deux requêtes d'une même transaction) — vérifié dans `pg/lib/client.js::
    // _handleErrorMessage` : SANS requête active, l'erreur part en `_handleErrorEvent` ->
    // `this.emit('error', err)`, un `EventEmitter.emit` NORMAL, jamais une exception — SANS
    // écouteur dessus à cet instant précis, Node la traite comme un événement non géré, promu en
    // `uncaughtException` PROCESS-WIDE : toute l'API meurt, tous tenants confondus, pour l'échec
    // d'un seul job.
    //
    // CORRECTIF : un écouteur `error` posé UNE FOIS PAR CONNEXION PHYSIQUE, à la création
    // (`pool.on('connect', ...)`), jamais retiré — `pg-pool` ne gère QUE SON PROPRE écouteur
    // interne (ajout/retrait à chaque cycle acquire/release), un `EventEmitter` accepte
    // plusieurs écouteurs simultanés sans conflit : le nôtre reste actif PENDANT la fenêtre où
    // celui de `pg-pool` est justement absent, fermant exactement le trou.
    //
    // PROUVÉ SANS RISQUE DE PROMESSE BLOQUÉE (relu `pg/lib/client.js` avant d'écrire ceci) : si
    // une requête ÉTAIT en vol au moment de la coupure, `pg` la fait déjà échouer proprement
    // (`activeQuery.handleError(...)`) — ce nouvel écouteur ne change rien à CE chemin. S'il n'y
    // en avait AUCUNE (notre cas mesuré), il n'y a RIEN à débloquer : le client est simplement
    // marqué non-utilisable (`_queryable = false`), et le PROCHAIN `tx.execute` de la transaction
    // en cours échoue avec un message clair (`Client has encountered a connection error and is
    // not queryable`) — une Promise REJETÉE, normale, que `enTenant`/l'appelant (ex.
    // `ServiceImportReprise.executer`, déjà doté d'un `try/catch` autour de toute la phase
    // d'écriture) rattrape et transforme en échec DE CE SEUL DOSSIER, jamais un crash process.
    //
    // Journalisé, jamais avalé en silence : un incident invisible serait pire que le crash qu'il
    // remplace — voir la doctrine de `observabilite/installer-gestionnaires-crash.ts`, INCHANGÉE
    // ici (elle reste le filet légitime pour tout ce qui n'est PAS cette classe précise d'erreur
    // de connexion récupérable).
    this.pool.on('connect', (client) => {
      client.on('error', (erreur) => {
        this.journal.error(
          `Erreur sur une connexion ACTIVE du pool (transaction en cours) : ${erreur.message}`,
        );
      });
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

  async enTenant<T>(ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<T>): Promise<T> {
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
      throw new Error(
        `ContexteTenant.requeteId dépasse ${String(LONGUEUR_MAX_REQUETE_ID)} caractères.`,
      );
    }

    try {
      // `await` explicite (pas `return this.base.transaction(...)` nu) : c'est ce qui permet au
      // `catch` ci-dessous d'intercepter un rejet de la promesse — un `return` direct la ferait
      // remonter tel quel à l'appelant de `enTenant`, hors de portée de ce `try`.
      return await this.base.transaction(async (tx) => {
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
    } catch (erreur) {
      // Un pool saturé (voir `erreur-pool-sature.ts`) n'est PAS un défaut applicatif : c'est un
      // 503 + `Retry-After`, jamais un `ERREUR_INTERNE`/500 anonyme qui laisse le client sans
      // savoir s'il doit réessayer. Rethrow inchangé pour tout le reste — `catch` sert UNIQUEMENT
      // à reconnaître ce cas précis, jamais à avaler une erreur.
      if (estErreurEpuisementPool(erreur)) {
        throw traduireErreurPoolSature(erreur);
      }
      throw erreur;
    }
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
    // Repris dans les messages de la section 3 : « aucune politique isolante » n'est
    // diagnosticable que si l'on sait pour QUEL rôle on a cherché.
    const nomRole = role?.rolname ?? 'rôle courant';

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
    // On n'inspecte pas seulement la FORME des politiques (présence de USING / WITH CHECK) mais
    // leur CONTENU : `using (true) with check (true)` a exactement la forme attendue et n'isole
    // rien du tout. C'est le motif qui existe légitimement pour dfa_migrator (§ ci-dessous) et
    // qui, recopié sur une table métier, ouvrirait tous les tenants les uns aux autres sans
    // qu'aucune erreur ne se produise nulle part.
    const tables = await this.base.execute<PostureTable>(sql`
      with role_courant as (
        select oid from pg_catalog.pg_roles where rolname = current_user
      ),
      politique_applicable as (
        -- SEULE frontière entre politiques applicatives et politiques de migration : le rôle
        -- visé. Les politiques « *_migrator » (TO dfa_migrator, using (true)) sont légitimes et
        -- documentées — sans elles, FORCE RLS empêcherait dfa_migrator de lire ses propres
        -- tables et un backfill s'exécuterait silencieusement sans toucher aucune ligne. Comme
        -- l'API se connecte en dfa_app, elles ne figurent tout simplement pas ici : on ne juge
        -- que ce qui s'applique au rôle de connexion de l'API.
        select p.polrelid,
               p.polname,
               p.polcmd,
               p.polpermissive,
               pg_catalog.pg_get_expr(p.polqual,      p.polrelid) as expr_using,
               pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) as expr_check
          from pg_catalog.pg_policy p
         where p.polroles = '{0}'::oid[]                                    -- TO public
            or (select oid from role_courant) = any (p.polroles)            -- TO <rôle courant>
      ),
      politique_jugee as (
        select a.*,
               -- \\m = début de mot : « faux_tenant_courant() » ne passe pas pour
               -- « tenant_courant() ». Le motif couvre les deux rendus possibles selon le
               -- search_path : « tenant_courant() » et « public.tenant_courant() ».
               (a.expr_using is not null and a.expr_using ~ '\\mtenant_courant\\s*\\(') as using_isole,
               (a.expr_check is not null and a.expr_check ~ '\\mtenant_courant\\s*\\(') as check_isole,
               a.polname
                 || ' [' || case a.polcmd
                              when '*' then 'ALL'    when 'r' then 'SELECT' when 'a' then 'INSERT'
                              when 'w' then 'UPDATE' when 'd' then 'DELETE' else a.polcmd::text
                            end || ']'
                 || ' USING '
                 || case when a.expr_using is null then 'absent'
                         when a.expr_using ~ '\\mtenant_courant\\s*\\(' then 'isolant'
                         else 'NON ISOLANT (' || a.expr_using || ')' end
                 || ', WITH CHECK '
                 || case when a.expr_check is null then 'absent'
                         when a.expr_check ~ '\\mtenant_courant\\s*\\(' then 'isolant'
                         else 'NON ISOLANT (' || a.expr_check || ')' end as description
          from politique_applicable a
         -- Seules les politiques PERMISSIVES sont jugées : elles s'additionnent (OR) et peuvent
         -- donc ouvrir la table. Une politique RESTRICTIVE s'intersecte (AND) et ne peut que
         -- restreindre — « as restrictive ... using (true) » est un no-op, pas une faille.
         where a.polpermissive
      )
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
               -- USING **et** WITH CHECK, tous deux via tenant_courant(). Une politique sans
               -- WITH CHECK isolant laisse un INSERT écrire le tenant_id d'autrui, et un UPDATE
               -- déplacer une ligne vers un autre tenant : la ligne disparaît alors de la vue de
               -- son auteur, ce qui rend la corruption indétectable côté application.
               select count(*)
                 from politique_jugee j
                where j.polrelid = c.oid
                  and j.using_isole
                  and j.check_isole
             )::int                                     as politiques_isolantes,
             coalesce(
               (
                 -- Une politique permissive qui filtre sur autre chose que tenant_courant()
                 -- ANNULE l'isolation des politiques voisines (elles sont OR-ées). Une table
                 -- peut donc avoir sa politique isolante ET fuiter : ce cas doit être une
                 -- erreur, pas un simple « il en existe au moins une bonne ».
                 -- Une expression ABSENTE n'est pas signalée : polqual est NULL par
                 -- construction sur une politique FOR INSERT, polwithcheck sur un FOR SELECT.
                 select array_agg(j.description order by j.polname)
                   from politique_jugee j
                  where j.polrelid = c.oid
                    and (
                      (j.expr_using is not null and not j.using_isole)
                      or (j.expr_check is not null and not j.check_isole)
                    )
               ),
               '{}'::text[]
             )                                          as politiques_non_isolantes,
             coalesce(
               (
                 select array_agg(j.description order by j.polname)
                   from politique_jugee j
                  where j.polrelid = c.oid
               ),
               '{}'::text[]
             )                                          as inventaire_politiques,
             -- Déclaration de posture : voir 0002_posture_declaree.sql. Sans commentaire, une
             -- table sans tenant_id n'a rien déclaré et sera refusée.
             pg_catalog.obj_description(c.oid, 'pg_class') as commentaire,
             -- Privilèges EFFECTIFS du rôle de connexion : has_table_privilege et non
             -- information_schema.table_privileges, qui n'énumère que les GRANT nominatifs et
             -- manquerait un privilège hérité d'un rôle ou accordé à PUBLIC.
             pg_catalog.has_table_privilege(c.oid, 'SELECT')   as peut_selectionner,
             pg_catalog.has_table_privilege(c.oid, 'INSERT')   as peut_inserer,
             pg_catalog.has_table_privilege(c.oid, 'UPDATE')   as peut_modifier,
             pg_catalog.has_table_privilege(c.oid, 'DELETE')   as peut_supprimer,
             pg_catalog.has_table_privilege(c.oid, 'TRUNCATE') as peut_tronquer,
             c.relispartition                                  as est_partition,
             (
               select h.inhparent::regclass::text
                 from pg_catalog.pg_inherits h
                where h.inhrelid = c.oid
                limit 1
             )                                                 as table_mere
        from pg_catalog.pg_class c
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         -- 'p' = table PARTITIONNÉE (la mère). Sans elle, une table partitionnée — l'étape 1 en
         -- prévoit une, audit_atelier — serait purement et simplement invisible à ce contrôle,
         -- donc dispensée de RLS, de politique et de tout le reste.
         -- Les PARTITIONS, elles, sont des relations 'r' ordinaires et sont jugées une à une,
         -- comme n'importe quelle table. Ce n'est pas un excès de zèle : mesuré sur cette base,
         -- une partition créée par « create table … partition of » n'hérite NI de
         -- relrowsecurity, NI de FORCE, NI des politiques de sa mère — mais hérite bien des
         -- privilèges. Un « select * from audit_atelier_2026_08 » en dfa_app rendait donc les
         -- lignes de TOUS les tenants pendant que la mère, elle, était irréprochable.
         and c.relkind in ('r', 'p')
       order by c.relname
    `);

    problemes.push(...analyserPostureTables(tables.rows, nomRole));

    if (problemes.length > 0) {
      throw new ErreurPostureRls(problemes);
    }
  }
}

/**
 * Verdict sur l'inventaire du catalogue, isolé de tout accès base pour être testable sans
 * conteneur. La requête ci-dessus décide ce qu'est une politique « isolante » ; cette fonction
 * décide ce qui est ACCEPTABLE et rédige le diagnostic.
 *
 * @param nomRole rôle de connexion pour lequel les politiques ont été évaluées (dfa_app en prod).
 */
export function analyserPostureTables(tables: readonly PostureTable[], nomRole: string): string[] {
  const problemes: string[] = [];

  if (tables.length === 0) {
    problemes.push(
      `aucune table dans le schéma public : les migrations n'ont pas été appliquées sur cette base`,
    );
  }

  for (const t of tables) {
    const problemesTable = analyserTable(t, nomRole);

    // R3 — la règle propre aux partitions : zéro privilège. Elle est évaluée AVANT les règles
    // d'isolation et indépendamment d'elles, parce qu'elle est la seule des deux à être une
    // frontière effective. Voir `analyserPartition`.
    if (t.est_partition) {
      problemes.push(...analyserPartition(t, nomRole));
    }

    // Une partition est jugée comme n'importe quelle table — mais l'auteur du DDL, lui, croit
    // légitimement avoir tout fait en posant la politique sur la mère. Sans cette précision, le
    // message « ROW LEVEL SECURITY non activé » sur une table qu'on n'a jamais écrite à la main
    // (elle est créée par un job mensuel) envoie chercher au mauvais endroit.
    if (t.est_partition && problemesTable.length > 0) {
      const mere = t.table_mere ?? 'sa table mère';
      problemes.push(
        ...problemesTable.map(
          (p) =>
            `${p}\n      ↳ « ${t.table_name} » est une PARTITION de ${mere}. Une partition n'hérite ` +
            `NI de ROW LEVEL SECURITY, NI de FORCE, NI des politiques de sa mère — mais elle hérite ` +
            `des PRIVILÈGES. La politique de ${mere} ne s'applique qu'aux accès PAR ${mere} : un ` +
            `« select … from ${t.table_name} » la contourne entièrement et rend les lignes de tous les ` +
            `tenants. Le job qui crée les partitions doit rejouer sur chacune enable + force + la ` +
            `politique d'isolation de ${mere}, et échouer bruyamment s'il n'y parvient pas.`,
        ),
      );
      continue;
    }

    problemes.push(...problemesTable);
  }

  return problemes;
}

/**
 * Verdict sur une PARTITION — règle R3 : le rôle applicatif n'y détient AUCUN privilège.
 *
 * Pourquoi c'est la règle la plus importante des trois, mesuré sur cette base et non déduit :
 * une partition créée par `create table … partition of` n'hérite NI de `relrowsecurity`, NI de
 * `FORCE`, NI des politiques de sa mère — mais elle hérite bien des PRIVILÈGES, que les
 * `default privileges` lui accordent au moment même de sa création. Une partition d'audit
 * fraîchement créée est donc, par défaut, entièrement lisible par `dfa_app` sans le moindre
 * filtre de tenant. Vérifié à deux reprises :
 *   - une politique `using (false)` posée sur la partition n'empêche NI la lecture NI l'écriture
 *     effectuées à travers la mère (les politiques de la partition ne sont consultées que si la
 *     partition est nommée dans la requête) ;
 *   - inversement, `select … from audit_atelier_2026_08` ne consulte AUCUNE politique de
 *     `audit_atelier`.
 *
 * Conséquence : le privilège est la seule frontière qui couvre les deux chemins d'accès. Les
 * règles d'isolation (RLS + FORCE + politique isolante) continuent malgré tout d'être exigées
 * de chaque partition — voir `analyserPostureTables`. Ce n'est pas de la redondance décorative :
 * elles ne coûtent rien (la lecture par la mère les ignore, mesuré), et elles sont ce qui
 * contient la fuite le jour où quelqu'un exécute un `grant select on all tables in schema public
 * to dfa_app` — un ordre qui semble anodin et qui, sans elles, rouvre d'un coup toutes les
 * partitions à tous les tenants.
 */
function analyserPartition(t: PostureTable, nomRole: string): string[] {
  const detenus = [
    t.peut_selectionner ? 'SELECT' : null,
    t.peut_inserer ? 'INSERT' : null,
    t.peut_modifier ? 'UPDATE' : null,
    t.peut_supprimer ? 'DELETE' : null,
    t.peut_tronquer ? 'TRUNCATE' : null,
  ].filter((p): p is string => p !== null);

  if (detenus.length === 0) {
    return [];
  }

  const mere = t.table_mere ?? 'sa table mère';

  return [
    `table « ${t.table_name} » : PARTITION de ${mere} sur laquelle « ${nomRole} » détient ${detenus.join(', ')}. ` +
      `Une partition n'hérite NI des politiques de sa mère, NI de ROW LEVEL SECURITY, NI de FORCE — mais elle ` +
      `hérite des PRIVILÈGES, que les « default privileges » lui accordent à la création. Un ` +
      `« select … from ${t.table_name} » ne consulte donc aucune politique de ${mere} et rend les lignes de TOUS ` +
      `les tenants. L'application n'a aucun besoin d'accéder à une partition nommément : la lecture, l'écriture ` +
      `et le routage passent tous par ${mere}, dont les politiques, elles, s'appliquent. ` +
      `Correction : revoke all on public.${t.table_name} from ${nomRole} — dans la migration ET dans le job qui ` +
      `crée les partitions, qui doit échouer bruyamment plutôt que laisser derrière lui une partition nue.`,
  ];
}

/** Verdict sur une table isolée. Extrait pour que l'appelant puisse enrichir le diagnostic. */
function analyserTable(t: PostureTable, nomRole: string): string[] {
  const problemes: string[] = [];
  const declaration = lireDeclaration(t.commentaire);

  // --- Hygiène de la déclaration elle-même ---------------------------------------------------
  // Un marqueur mal orthographié est le pire des cas : l'auteur croit avoir déclaré, le contrôle
  // ne voit rien, et le verdict dépend d'une coquille. On refuse tout `[dfa:…]` hors vocabulaire.
  for (const inconnu of declaration.inconnus) {
    problemes.push(
      `table « ${t.table_name} » : marqueur de posture « [${inconnu}] » inconnu. Vocabulaire admis : ` +
        `[${MARQUEUR_REFERENTIEL}], [${MARQUEUR_HORS_PORTEE}], [${MARQUEUR_SUPPRESSION}] ` +
        `(voir 0002_posture_declaree.sql).`,
    );
  }

  if (
    declaration.marqueurs.size > 0 &&
    declaration.justification.length < LONGUEUR_MIN_JUSTIFICATION
  ) {
    problemes.push(
      `table « ${t.table_name} » : marqueur de posture posé sans justification. Le commentaire doit expliquer ` +
        `POURQUOI cette table déroge, en clair et à côté du marqueur (au moins ${String(LONGUEUR_MIN_JUSTIFICATION)} ` +
        `caractères). Une exception dont la raison n'est pas écrite se perd à la première relecture.`,
    );
  }

  // --- TRUNCATE : refus inconditionnel, aucun marqueur ne l'ouvre -----------------------------
  // TRUNCATE ne consulte AUCUNE politique RLS : un seul ordre viderait la table de tous les
  // tenants à la fois, y compris depuis une injection SQL réussie dans une requête métier.
  // Aucun besoin applicatif ne le justifie — la purge s'écrit en DELETE, sous RLS.
  //
  // Les partitions sont exemptées de CE contrôle-ci et du suivant, non par tolérance mais par
  // sévérité : `analyserPartition` leur interdit TOUT privilège, TRUNCATE et DELETE compris.
  // Les laisser passer ici produirait deux messages pour une seule faute, dont un qui
  // proposerait le mauvais remède (« revoke delete » là où il faut « revoke all »).
  if (t.peut_tronquer && !t.est_partition) {
    problemes.push(
      `table « ${t.table_name} » : le rôle « ${nomRole} » détient TRUNCATE. TRUNCATE contourne intégralement ` +
        `le RLS et supprimerait les lignes de TOUS les tenants. Aucune déclaration ne l'autorise : ` +
        `revoke truncate on public.${t.table_name} from ${nomRole}.`,
    );
  }

  // --- DELETE : autorisé seulement s'il est déclaré -------------------------------------------
  // Correctif du trou n°2 : `alter default privileges` accordait DELETE à toute nouvelle table,
  // et la règle « rien n'est physiquement supprimé » ne tenait qu'à un `revoke delete` à ne pas
  // oublier dans chaque migration. 0002 retire DELETE du défaut ; ce contrôle rattrape le cas
  // restant — une migration qui écrit un `grant delete` ou un `grant all` explicite.
  if (t.peut_supprimer && !t.est_partition && !declaration.marqueurs.has(MARQUEUR_SUPPRESSION)) {
    problemes.push(
      `table « ${t.table_name} » : le rôle « ${nomRole} » détient DELETE sans déclaration. La suppression est ` +
        `LOGIQUE par défaut dans dmsforall (documents de vente, mouvements de stock, pointages : rien n'est ` +
        `physiquement supprimé). Soit la migration ajoute « revoke delete on public.${t.table_name} from ` +
        `${nomRole} », soit elle déclare l'exception : comment on table public.${t.table_name} is '… ` +
        `[${MARQUEUR_SUPPRESSION}] <raison> '.`,
    );
  }

  // La table `tenant` s'isole sur `id` et non sur `tenant_id` : elle est son propre tenant.
  const doitEtreIsolee = t.porte_tenant_id || t.table_name === 'tenant';

  // Une table SANS tenant_id est jugée AVANT d'exiger RLS actif — et c'est délibéré, pas un
  // relâchement. `analyserTableSansTenant()` l'explique dans son propre commentaire : sans
  // colonne `tenant_id`, aucune politique RLS n'a rien à filtrer, donc `using (true)` est la
  // SEULE politique écrivable et elle ne protège rien. La seule frontière réelle pour ces
  // tables est le PRIVILÈGE (SELECT seul pour un référentiel partagé, aucun pour une table hors
  // portée) — c'est exactement ce que cette fonction vérifie, indépendamment de `rls_active`.
  //
  // Poser du RLS ici serait du théâtre : soit une politique qui filtre sur une colonne
  // inexistante (impossible), soit `using (true)` qui laisse tout passer — pire que l'absence de
  // politique, puisqu'elle donne l'illusion d'une protection à la lecture du catalogue. Exiger
  // `rls_active` avant même de regarder le marqueur transformait chaque référentiel partagé
  // légitime (`[dfa:referentiel-partage]`, `[dfa:hors-portee-app]`) en obligation de poser cette
  // même politique décorative pour pouvoir démarrer — constaté sur `type_approbation_ch` (0050),
  // déclarée et bornée en privilèges mais sans RLS, refusée par ce seul ordre de contrôle avant
  // que le marqueur n'ait jamais été lu. Voir 0050_referentiel_vehicules_ch.sql.
  if (!doitEtreIsolee) {
    problemes.push(...analyserTableSansTenant(t, declaration, nomRole));
    return problemes;
  }

  // À partir d'ici, la table PORTE tenant_id (ou est `tenant`) : c'est le motif standard, et lui
  // seul exige un RLS réellement actif — colonne à filtrer, donc politique isolante possible et
  // obligatoire.
  if (!t.rls_active) {
    problemes.push(`table « ${t.table_name} » : ROW LEVEL SECURITY non activé`);
    return problemes;
  }

  // Un marqueur de portée sur une table qui PORTE `tenant_id` est une contradiction : soit la
  // table est un référentiel partagé et elle n'a rien à faire d'un tenant_id, soit elle est
  // métier et le marqueur est un copier-coller. Dans les deux cas, quelqu'un s'est trompé.
  for (const marqueur of [MARQUEUR_REFERENTIEL, MARQUEUR_HORS_PORTEE]) {
    if (declaration.marqueurs.has(marqueur)) {
      problemes.push(
        `table « ${t.table_name} » : marqueur « [${marqueur}] » posé sur une table qui porte tenant_id. ` +
          `Ce marqueur ne concerne que les tables SANS tenant_id — une table métier doit suivre le motif ` +
          `standard (politique isolante + FORCE), jamais s'en déclarer dispensée.`,
      );
    }
  }

  // Une politique permissive qui n'isole pas est PIRE qu'une politique manquante : elle rouvre
  // la table même si une politique correcte existe juste à côté (les permissives sont OR-ées).
  // On la signale donc indépendamment du nombre de politiques isolantes.
  for (const politique of t.politiques_non_isolantes) {
    problemes.push(
      `table « ${t.table_name} » : politique permissive NON ISOLANTE applicable à « ${nomRole} » — ${politique}. ` +
        `Une politique permissive s'ADDITIONNE aux autres (OR) : celle-ci donne accès à toutes les lignes de tous ` +
        `les tenants, quelles que soient les politiques voisines. Toute expression doit filtrer via ` +
        `tenant_courant() — modèle : using (tenant_id = public.tenant_courant()) ` +
        `with check (tenant_id = public.tenant_courant()). Le motif « using (true) » n'est admis que sur les ` +
        `politiques TO dfa_migrator (voir 0001_socle_rls.sql §4).`,
    );
  }

  if (t.politiques_isolantes < 1) {
    problemes.push(
      `table « ${t.table_name} » : aucune politique isolante applicable à « ${nomRole} » — attendu une politique ` +
        `permissive portant USING ET WITH CHECK, tous deux exprimés via tenant_courant() (modèle : ` +
        `create policy ${t.table_name}_isolation_tenant on public.${t.table_name} to dfa_app ` +
        `using (tenant_id = public.tenant_courant()) with check (tenant_id = public.tenant_courant())). ` +
        `Politiques applicables vues : ${
          t.inventaire_politiques.length > 0 ? t.inventaire_politiques.join(' | ') : 'aucune'
        }`,
    );
  }

  if (!t.rls_force && !TABLES_SANS_FORCE_RLS.has(t.table_name)) {
    problemes.push(
      `table « ${t.table_name} » : FORCE ROW LEVEL SECURITY manquant (exception admise uniquement pour ${[...TABLES_SANS_FORCE_RLS].join(', ')})`,
    );
  }

  return problemes;
}

/**
 * Verdict sur une table SANS `tenant_id`.
 *
 * C'est ici que se joue le trou n°1. Jusqu'à 0002, une telle table était simplement ignorée :
 * une table métier à laquelle on avait oublié `tenant_id`, munie de la politique du socle recopiée
 * (`to dfa_app using (true) with check (true)`), démarrait l'API sans un mot — et dfa_app y lisait,
 * écrivait et supprimait toutes les lignes hors de tout contexte tenant. Constaté en exécution.
 *
 * Désormais : pas de déclaration, pas de démarrage. Et la déclaration n'ouvre rien par elle-même,
 * puisqu'on vérifie qu'elle correspond aux privilèges réels — c'est ce qui interdit qu'une table
 * métier « passe pour un référentiel » : il faudrait pour cela qu'elle soit effectivement en
 * lecture seule, auquel cas elle ne serait plus une table métier.
 *
 * Ce que le RLS ne peut PAS faire ici, et pourquoi le privilège est le bon levier : une table sans
 * `tenant_id` n'a aucune colonne sur laquelle une politique pourrait discriminer. `using (true)`
 * est donc la seule politique écrivable, et elle ne protège rien. La seule frontière disponible
 * est le privilège de table — d'où le contrôle sur SELECT/INSERT/UPDATE/DELETE et non sur les
 * politiques.
 */
function analyserTableSansTenant(
  t: PostureTable,
  declaration: DeclarationPosture,
  nomRole: string,
): string[] {
  const problemes: string[] = [];

  const estReferentiel = declaration.marqueurs.has(MARQUEUR_REFERENTIEL);
  const estHorsPortee = declaration.marqueurs.has(MARQUEUR_HORS_PORTEE);

  if (estReferentiel && estHorsPortee) {
    problemes.push(
      `table « ${t.table_name} » : marqueurs « [${MARQUEUR_REFERENTIEL}] » et « [${MARQUEUR_HORS_PORTEE}] » ` +
        `posés ensemble. Ils s'excluent : le premier accorde SELECT à ${nomRole}, le second exige zéro privilège.`,
    );
    return problemes;
  }

  if (!estReferentiel && !estHorsPortee) {
    problemes.push(
      `table « ${t.table_name} » : aucune colonne tenant_id et aucune déclaration de posture. ` +
        `Une table du schéma public sans tenant_id est, par défaut, une table métier à laquelle on l'a OUBLIÉ — ` +
        `et elle est alors lisible et modifiable par tous les tenants à la fois, sans qu'aucune politique RLS ne ` +
        `puisse l'en empêcher (il n'y a pas de colonne sur laquelle filtrer). Deux issues, aucune par omission : ` +
        `(1) ajouter « tenant_id uuid not null » et la politique standard ; ` +
        `(2) si c'est réellement un référentiel partagé par tous les tenants, le déclarer dans la migration — ` +
        `comment on table public.${t.table_name} is '<raison> [${MARQUEUR_REFERENTIEL}] <justification>' — ` +
        `et n'accorder que SELECT à ${nomRole}. Voir 0002_posture_declaree.sql.`,
    );
    return problemes;
  }

  // --- La déclaration doit correspondre aux privilèges réels ------------------------------------

  if (estReferentiel) {
    // Un référentiel partagé est en LECTURE SEULE pour l'application, sans quoi un tenant
    // modifierait les données vues par tous les autres — le contraire exact de l'étanchéité, et
    // avec un rayon d'action bien plus large qu'une fuite entre deux tenants.
    const interdits = [
      t.peut_inserer ? 'INSERT' : null,
      t.peut_modifier ? 'UPDATE' : null,
      t.peut_supprimer ? 'DELETE' : null,
    ].filter((p): p is string => p !== null);

    if (interdits.length > 0) {
      problemes.push(
        `table « ${t.table_name} » : déclarée « [${MARQUEUR_REFERENTIEL}] » mais « ${nomRole} » y détient ` +
          `${interdits.join(', ')}. Un référentiel partagé est en lecture seule pour l'application : une écriture ` +
          `y modifierait les données vues par TOUS les tenants. Son contenu appartient aux migrations. ` +
          `Correction : revoke ${interdits.join(', ').toLowerCase()} on public.${t.table_name} from ${nomRole}.`,
      );
    }
    // Rien à exiger côté politiques : avec SELECT seul, la politique `using (true)` ne peut
    // qu'autoriser une lecture d'un contenu identique pour tous. FORCE n'est pas exigé non plus —
    // il empêcherait dfa_migrator d'alimenter le référentiel sans lui ajouter une politique.
    return problemes;
  }

  // estHorsPortee : la déclaration affirme que l'application ne touche pas cette table. On le
  // vérifie, sinon le marqueur devient un laissez-passer pour n'importe quelle table technique.
  const detenus = [
    t.peut_selectionner ? 'SELECT' : null,
    t.peut_inserer ? 'INSERT' : null,
    t.peut_modifier ? 'UPDATE' : null,
    t.peut_supprimer ? 'DELETE' : null,
  ].filter((p): p is string => p !== null);

  if (detenus.length > 0) {
    problemes.push(
      `table « ${t.table_name} » : déclarée « [${MARQUEUR_HORS_PORTEE}] » mais « ${nomRole} » y détient ` +
        `${detenus.join(', ')}. Ce marqueur affirme que l'application n'a AUCUN accès à cette table ; ` +
        `il ne peut pas servir à dispenser d'isolation une table réellement accessible. ` +
        `Correction : revoke all on public.${t.table_name} from ${nomRole}, ou déclarer la vraie posture.`,
    );
  }

  return problemes;
}
