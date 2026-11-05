/**
 * Harnais Postgres éphémère pour les tests d'intégration (testcontainers).
 *
 * Point non négociable (CONTRIBUTING.md, ARCHITECTURE.md, contrat étape 0 §3) : le conteneur
 * éphémère doit reproduire la POSTURE DE PRODUCTION, sinon les tests RLS ne prouvent rien.
 * On applique donc scrupuleusement la même séquence qu'un déploiement réel :
 *
 *   1. démarrer un Postgres 16 propre, avec un superutilisateur qui ne sert QU'À amorcer ;
 *   2. rejouer TEL QUEL `docker/postgres/init/01-roles.sql` (le même script que
 *      docker-compose.yml monte dans /docker-entrypoint-initdb.d/ en dev) pour créer les
 *      rôles `dfa_migrator` et `dfa_app` — NOSUPERUSER, NOBYPASSRLS tous les deux ;
 *   3. appliquer les migrations avec `dfa_migrator` (comme en prod : DATABASE_URL_MIGRATION) ;
 *   4. ne rendre à l'appelant que des accès `dfa_app` (comme en prod : DATABASE_URL) pour tout
 *      ce qui n'est pas explicitement une vérification de posture ou une opération d'amorçage
 *      de fixtures.
 *
 * Un test RLS qui tournerait en superutilisateur ou avec un rôle BYPASSRLS passerait TOUJOURS,
 * qu'il y ait ou non une politique posée derrière — il ne testerait donc rien. C'est
 * exactement l'erreur que ce fichier existe pour rendre impossible.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { Client, Pool, type PoolClient } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { determinerModeEphemere } from './mode-ephemere';

// Module CommonJS : `__dirname` est fourni par le runtime, pas besoin de `import.meta.url`.

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------------------------
// Constantes de convention. Deux d'entre elles sont des HYPOTHÈSES documentées, à confirmer par
// l'équipe base de données à l'intégration (le contrat gelé §3 ne fixe que les NOMS des deux premières
// migrations, pas le dossier qui les contient) :
//   - DOSSIER_MIGRATIONS      : convention drizzle-kit standard (`drizzle/migrations` à la
//                                racine du package). Si l'équipe base de données a choisi un autre
//                                dossier, ajuster cette seule constante suffit.
//   - DOSSIER_MIGRATIONS_DOWN : sous-dossier `down/` du même dossier, comme décrit au contrat
//                                ("migrations/down/NNNN_x.down.sql").
// ---------------------------------------------------------------------------------------------

/** Réutilise TEL QUEL le script qui sert aussi en dev (docker-compose.yml) et en prod
 *  (rejoué à la main sur l'instance managée) — c'est le même dispositif de rôles partout,
 *  jamais une redéfinition en dur dans les tests qui pourrait diverger silencieusement. */
const CHEMIN_SCRIPT_ROLES = path.resolve(
  __dirname,
  '../../../../docker/postgres/init/01-roles.sql',
);

const DOSSIER_MIGRATIONS = path.resolve(__dirname, '../../src/db/migrations');
const DOSSIER_MIGRATIONS_DOWN = path.join(DOSSIER_MIGRATIONS, 'down');

const NOM_BASE = 'dfa_test';
const SUPERUTILISATEUR = 'dfa_superutilisateur_test';
const SUPERUTILISATEUR_MDP = 'dfa_superutilisateur_test_mdp';

// Mots de passe repris tels quels de docker/postgres/init/01-roles.sql (valeurs de dev
// explicitement documentées comme non sensibles dans ce fichier — jamais utilisées en prod).
const MDP_MIGRATEUR = 'dfa_migrator_dev';
const MDP_APP = 'dfa_app_dev';
const MDP_CONSOLE = 'dfa_console_dev';

// ---------------------------------------------------------------------------------------------
// Mode "base jetable" (voir mode-ephemere.ts) : au lieu d'un conteneur testcontainers, une base
// jetable est créée sur l'instance Postgres DÉJÀ EN MARCHE de `pnpm docker:up`
// (docker-compose.yml : conteneur `dfa-postgres`, superuser `dfa`, port 5432 — hors de la plage
// éphémère morte en Docker rootless sur ce poste). Identifiants et hôte repris tels quels de
// docker-compose.yml (POSTGRES_USER/POSTGRES_PASSWORD), overridables par variable d'env pour un
// poste dont la config locale diverge.
// ---------------------------------------------------------------------------------------------

/** Jamais touchée par ce harnais — c'est la base de développement de @laupernoe. Garde-fou dur, pas une
 *  simple convention : voir `refuserBaseInterdite`. */
const NOM_BASE_DEV_INTERDITE = 'dfa_dev';

const HOTE_JETABLE = process.env.DFA_TEST_PG_HOTE ?? 'localhost';
const PORT_JETABLE = Number(process.env.DFA_TEST_PG_PORT ?? 5432);
const ADMIN_JETABLE_UTILISATEUR = process.env.DFA_TEST_PG_ADMIN_UTILISATEUR ?? 'dfa';
const ADMIN_JETABLE_MDP = process.env.DFA_TEST_PG_ADMIN_MDP ?? 'dfa_dev_local';
/** Base de maintenance PostgreSQL, toujours présente, utilisée uniquement pour se connecter le
 *  temps de CREATE DATABASE / DROP DATABASE — jamais pour y écrire quoi que ce soit d'autre. */
const BASE_MAINTENANCE = 'postgres';
/** `container_name` de docker-compose.yml — seul repère fiable pour shell `pg_dump` DEDANS
 *  plutôt que d'exiger un client Postgres sur l'hôte (voir `dumperSchemaViaDockerExec`). */
const CONTENEUR_DEV_POSTGRES = 'dfa-postgres';

/** Refuse de démarrer si le nom de base cible est la base de développement. Appelé sur le nom
 *  généré (jamais choisi par l'appelant — ce harnais ne prend aucun paramètre de nom en entrée),
 *  en garde-fou dur : si cette fonction se déclenchait un jour, ce serait un bug de génération
 *  de nom, jamais une situation à contourner. */
function refuserBaseInterdite(nomBase: string): void {
  if (nomBase === NOM_BASE_DEV_INTERDITE) {
    throw new Error(
      `[postgres-ephemere] refus de démarrer : le nom de base cible est "${NOM_BASE_DEV_INTERDITE}"` +
        ` — la base de développement. Le harnais de test ne doit JAMAIS la créer, migrer ni la ` +
        `supprimer. Ceci indique un bug dans la génération du nom de base éphémère.`,
    );
  }
}

function genererNomBaseJetable(): string {
  const horodatage = Date.now().toString(36);
  const alea = randomBytes(4).toString('hex');
  // Préfixe distinct de NOM_BASE (mode testcontainers) : les deux modes ne doivent jamais être
  // confondus en lisant un nom de base dans un journal.
  return `dfa_test_jetable_${horodatage}_${alea}`;
}

export interface IdentifiantsRole {
  readonly utilisateur: string;
  readonly motDePasse: string;
  readonly url: string;
}

export interface BaseEphemere {
  /** Présent UNIQUEMENT en mode testcontainers (voir mode-ephemere.ts) — `undefined` en mode
   *  base jetable, qui n'a pas de conteneur à lui : la base vit sur l'instance `dfa-postgres`
   *  déjà en marche. Aucun test métier ne doit dépendre de ce champ ; seul `dumperSchema`
   *  ci-dessous (posé sur CETTE interface, pas sur `conteneur`) doit être utilisé. */
  readonly conteneur: StartedPostgreSqlContainer | undefined;
  readonly nomBase: string;
  readonly migrateur: IdentifiantsRole;
  readonly app: IdentifiantsRole;
  readonly superutilisateur: IdentifiantsRole;
  /** Pool ouvert avec le rôle `dfa_app` — celui que l'API utilise réellement en exécution.
   *  Soumis au RLS comme n'importe quelle connexion applicative. À utiliser pour TOUT test qui
   *  prétend vérifier l'isolation tenant. */
  readonly poolApp: Pool;
  /** Pool ouvert avec le rôle `dfa_migrator` — propriétaire des tables, mais NOSUPERUSER et
   *  NOBYPASSRLS. Réservé aux tests de migrations et aux opérations d'amorçage sur les tables
   *  exemptées de FORCE ROW LEVEL SECURITY (utilisateur, session, journal_securite — voir le
   *  contrat §3). Ne JAMAIS s'en servir pour une assertion d'isolation : sur les tables FORCÉES
   *  (tenant, site, ...), même le propriétaire est soumis au RLS, donc ce pool échouerait de
   *  toute façon à y lire/écrire sans contexte tenant — mais ce n'est pas pour autant un
   *  substitut valable au pool `dfa_app` pour prouver l'isolation. */
  readonly poolMigrateur: Pool;
  /** Connexion superutilisateur du conteneur. Contourne le RLS PAR CONCEPTION (un superutilisateur
   *  Postgres bypasse toujours le RLS, FORCE ou non — c'est la seule échappatoire légitime pour
   *  amorcer des données de fixture sur des tables comme `tenant`/`site` où même le propriétaire
   *  est soumis à FORCE ROW LEVEL SECURITY). Réservé à `fixtures/garage-demo.ts` et aux
   *  vérifications de catalogue (pg_roles, pg_class, pg_policy) qui doivent voir l'état réel,
   *  indépendamment de tout contexte tenant. JAMAIS utilisé pour une assertion métier : ce
   *  serait tester avec un rôle qui n'existe pas en production. */
  readonly poolSuperutilisateur: Pool;
  /** Dump `--schema-only` du schéma courant, normalisé (voir `normaliserDumpSchema`). Remplace
   *  l'ancien export libre `dumperSchema(conteneur, role)` : chaque backend (testcontainers /
   *  jetable) sait comment shell `pg_dump` pour SA base — testcontainers l'exécute dans son
   *  propre conteneur éphémère, la base jetable réutilise le conteneur `dfa-postgres` de
   *  `pnpm docker:up` (voir `dumperSchemaViaDockerExec`). Seul `migrations.spec.ts` s'en sert. */
  dumperSchema(roleMigrateur: IdentifiantsRole): Promise<string>;
  fermer(): Promise<void>;
}

export interface OptionsBaseEphemere {
  /** false : ne PAS appliquer les migrations automatiquement (migrations.spec.ts pilote
   *  lui-même la séquence up → down → up). true par défaut pour tous les autres specs, qui
   *  veulent simplement un schéma prêt à l'emploi. */
  readonly appliquerMigrations?: boolean;
}

/**
 * Point d'entrée unique, utilisé par TOUS les specs d'intégration : bascule entre les deux
 * mécanismes selon `determinerModeEphemere()` (voir mode-ephemere.ts). La forme rendue
 * (`BaseEphemere`) est identique dans les deux cas — aucun spec n'a besoin de savoir lequel a
 * tourné, sauf `migrations.spec.ts` via la méthode `dumperSchema` ci-dessus.
 */
export async function demarrerBaseEphemere(
  options: OptionsBaseEphemere = {},
): Promise<BaseEphemere> {
  const mode = determinerModeEphemere();
  return mode === 'jetable'
    ? demarrerBaseEphemereJetable(options)
    : demarrerBaseEphemereTestcontainers(options);
}

/** Attache un écouteur d'erreur sur chacun des trois pools applicatifs (voir la note détaillée
 *  ci-dessous, reprise à l'identique des deux backends) puis vérifie la connectivité via
 *  `poolApp`. Factorisé : c'était dupliqué mot pour mot entre les deux implémentations. */
async function finaliserPools(
  poolApp: Pool,
  poolMigrateur: Pool,
  poolSuperutilisateur: Pool,
): Promise<void> {
  // Sans ce gestionnaire, une erreur sur une connexion INACTIVE de l'un de ces trois pools —
  // le conteneur/la base qui reçoit un admin_shutdown (57P01) pendant qu'une connexion reste
  // ouverte, un démon Docker à court de mémoire, ... — remonte en `unhandledError`
  // d'EventEmitter et tue tout le PROCESSUS de test, y compris les suites d'autres fichiers qui
  // n'ont rien à voir. Même raisonnement, même correctif que `ServiceAccesBase`/
  // `ServiceAccesAmorcage` (apps/api/src/db/acces-base.service.ts, acces-amorcage.service.ts) et
  // le client Redis partagé (apps/api/src/common/limitation/redis.provider.ts) : ces pools
  // applicatifs ont déjà l'écouteur, mais poolApp/poolMigrateur/poolSuperutilisateur sont
  // ouverts DIRECTEMENT par ce harnais, en dehors de tout cycle de vie NestJS, et n'en héritent
  // donc pas. On journalise fort (console.error, pas un `debug` silencieux) : perdre la trace
  // d'une base morte en cours de suite serait presque aussi grave que l'absence d'écouteur.
  for (const [nom, pool] of [
    ['app', poolApp],
    ['migrateur', poolMigrateur],
    ['superutilisateur', poolSuperutilisateur],
  ] as const) {
    pool.on('error', (erreur) => {
      console.error(
        `[postgres-ephemere] erreur sur une connexion inactive du pool ${nom} : ${erreur.message}`,
      );
    });
  }

  // Vérification de connectivité immédiate : mieux vaut un échec clair ici qu'un timeout
  // mystérieux 100 lignes plus loin dans le premier test qui s'en sert.
  await poolApp.query('select 1');
}

// ---------------------------------------------------------------------------------------------
// Backend 1/2 : testcontainers (comportement historique, inchangé). Conteneur Postgres neuf à
// chaque appel, rôles amorcés en rejouant `01-roles.sql` TEL QUEL (cluster vide, rien n'existe
// encore) — voir le commentaire d'en-tête du fichier pour la séquence complète.
// ---------------------------------------------------------------------------------------------

async function demarrerBaseEphemereTestcontainers(
  options: OptionsBaseEphemere,
): Promise<BaseEphemere> {
  const appliquerMigrations = options.appliquerMigrations ?? true;

  const conteneur = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase(NOM_BASE)
    .withUsername(SUPERUTILISATEUR)
    .withPassword(SUPERUTILISATEUR_MDP)
    // Encodage/locale alignés sur docker-compose.yml (POSTGRES_INITDB_ARGS) : les montants,
    // dates et tris doivent se comporter à l'identique entre dev, CI et prod.
    .withEnvironment({ POSTGRES_INITDB_ARGS: '--encoding=UTF8 --locale=C.UTF-8' })
    .start();

  const construireUrl = (utilisateur: string, motDePasse: string): string =>
    `postgresql://${utilisateur}:${motDePasse}@${conteneur.getHost()}:${conteneur.getPort()}/${NOM_BASE}`;

  const superutilisateur: IdentifiantsRole = {
    utilisateur: SUPERUTILISATEUR,
    motDePasse: SUPERUTILISATEUR_MDP,
    url: construireUrl(SUPERUTILISATEUR, SUPERUTILISATEUR_MDP),
  };
  const migrateur: IdentifiantsRole = {
    utilisateur: 'dfa_migrator',
    motDePasse: MDP_MIGRATEUR,
    url: construireUrl('dfa_migrator', MDP_MIGRATEUR),
  };
  const app: IdentifiantsRole = {
    utilisateur: 'dfa_app',
    motDePasse: MDP_APP,
    url: construireUrl('dfa_app', MDP_APP),
  };

  // Étape 2 : rejouer le script de rôles réel, en tant que superutilisateur, exactement comme
  // le ferait /docker-entrypoint-initdb.d/ en dev ou l'admin de l'instance managée en prod.
  const scriptRoles = readFileSync(CHEMIN_SCRIPT_ROLES, 'utf8');
  const clientAmorcage = new Client({ connectionString: superutilisateur.url });
  await clientAmorcage.connect();
  try {
    // `Client.query(texte)` sans paramètres utilise le protocole "simple query" de Postgres,
    // qui accepte nativement plusieurs instructions séparées par `;` — pas besoin de découper
    // le script en instructions individuelles.
    await clientAmorcage.query(scriptRoles);
  } finally {
    await clientAmorcage.end();
  }

  // Étape 3 : migrations avec dfa_migrator, comme en production.
  if (appliquerMigrations) {
    const clientMigrateur = new Client({ connectionString: migrateur.url });
    await clientMigrateur.connect();
    try {
      await appliquerMigrationsUp(clientMigrateur);
    } finally {
      await clientMigrateur.end();
    }
  }

  // Étape 4 : seuls des accès dfa_app / dfa_migrator / superutilisateur (chacun pour son usage
  // documenté ci-dessus) sont rendus à l'appelant.
  const poolApp = new Pool({ connectionString: app.url, max: 5 });
  const poolMigrateur = new Pool({ connectionString: migrateur.url, max: 3 });
  const poolSuperutilisateur = new Pool({ connectionString: superutilisateur.url, max: 3 });
  await finaliserPools(poolApp, poolMigrateur, poolSuperutilisateur);

  return {
    conteneur,
    nomBase: NOM_BASE,
    migrateur,
    app,
    superutilisateur,
    poolApp,
    poolMigrateur,
    poolSuperutilisateur,
    dumperSchema: (roleMigrateur) => dumperSchemaViaConteneur(conteneur, roleMigrateur),
    async fermer(): Promise<void> {
      await Promise.all([poolApp.end(), poolMigrateur.end(), poolSuperutilisateur.end()]);
      await conteneur.stop();
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Backend 2/2 : base jetable, sur l'instance Postgres déjà en marche (`pnpm docker:up`). Le
// CLUSTER existe déjà (rôles créés une fois pour toutes par 01-roles.sql à l'init du volume) ;
// seule la BASE est nouvelle à chaque appel — donc seuls les droits PAR BASE (propriété du
// schéma `public`, USAGE, CREATE ON DATABASE) doivent être reposés ici, jamais les rôles
// eux-mêmes (voir `assurerRolesTestExistent`, qui vérifie plutôt que suppose, et ne recrée QUE
// ce qui manque vraiment).
// ---------------------------------------------------------------------------------------------

function urlAdmin(nomBase: string): string {
  return `postgresql://${ADMIN_JETABLE_UTILISATEUR}:${ADMIN_JETABLE_MDP}@${HOTE_JETABLE}:${PORT_JETABLE}/${nomBase}`;
}

function construireUrlJetable(nomBase: string, utilisateur: string, motDePasse: string): string {
  return `postgresql://${utilisateur}:${motDePasse}@${HOTE_JETABLE}:${PORT_JETABLE}/${nomBase}`;
}

/** Vérifie l'existence des trois rôles applicatifs au niveau du CLUSTER (visibles depuis
 *  n'importe quelle base, `pg_roles` n'est pas scopé par base) et ne crée que ceux qui manquent
 *  réellement — jamais un aveugle "recrée tout", qui échouerait sur les rôles déjà là (already
 *  exists) et qui, plus grave, ne doit JAMAIS toucher aux attributs d'un rôle partagé par le
 *  cluster de dev (aucun ALTER ROLE ici, contrairement à `01-roles.sql` qui ne le fait que sur
 *  `dfa_prod`). Mêmes attributs que 01-roles.sql : NOSUPERUSER NOCREATEDB NOCREATEROLE
 *  NOBYPASSRLS — un rôle recréé ici avec une posture plus permissive rendrait `verifierPostureRls`
 *  inutile sans qu'aucun test ne le remarque. */
async function assurerRolesTestExistent(clientAdmin: Client): Promise<void> {
  const attendus: ReadonlyArray<readonly [string, string]> = [
    ['dfa_migrator', MDP_MIGRATEUR],
    ['dfa_app', MDP_APP],
    ['dfa_console', MDP_CONSOLE],
  ];
  const resultat = await clientAdmin.query<{ rolname: string }>(
    `select rolname from pg_roles where rolname = any($1::text[])`,
    [attendus.map(([nom]) => nom)],
  );
  const existants = new Set(resultat.rows.map((ligne) => ligne.rolname));
  for (const [nom, motDePasse] of attendus) {
    if (existants.has(nom)) continue;
    console.warn(
      `[postgres-ephemere][jetable] rôle "${nom}" absent du cluster local — création idempotente. ` +
        `Attendu : déjà créé par docker/postgres/init/01-roles.sql via \`pnpm docker:up\` sur un ` +
        `volume neuf. Si ce message apparaît en routine, le volume dfa_postgres_data a peut-être ` +
        `été recréé sans rejouer l'init (voir docker-compose.yml, piège documenté).`,
    );
    // Mots de passe fixes issus de nos propres constantes (jamais une entrée utilisateur) :
    // interpolation directe sans risque d'injection ici, DDL de rôle non paramétrable par le
    // pilote `pg` de toute façon.
    await clientAdmin.query(
      `create role ${nom} with login password '${motDePasse}' nosuperuser nocreatedb nocreaterole nobypassrls`,
    );
  }
}

async function demarrerBaseEphemereJetable(options: OptionsBaseEphemere): Promise<BaseEphemere> {
  const appliquerMigrations = options.appliquerMigrations ?? true;

  const nomBase = genererNomBaseJetable();
  refuserBaseInterdite(nomBase);

  // Étape 1 : connexion de maintenance (base `postgres`, toujours présente) pour vérifier/créer
  // les rôles manquants puis créer la base jetable elle-même.
  const clientMaintenance = new Client({ connectionString: urlAdmin(BASE_MAINTENANCE) });
  try {
    await clientMaintenance.connect();
  } catch (erreur) {
    await clientMaintenance.end().catch(() => undefined);
    throw new Error(
      `[postgres-ephemere][jetable] impossible de joindre l'instance Postgres locale ` +
        `(${HOTE_JETABLE}:${PORT_JETABLE}). \`pnpm docker:up\` a-t-il été lancé ? Cause : ` +
        `${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
  try {
    await assurerRolesTestExistent(clientMaintenance);
    // Identifiant entre guillemets doubles : un nom généré par `genererNomBaseJetable` ne
    // contient jamais de caractère spécial (alphanumérique + underscore), mais on cite quand
    // même par discipline — jamais de nom de base interpolé sans guillemets dans du DDL.
    await clientMaintenance.query(`create database "${nomBase}" encoding 'UTF8'`);
  } finally {
    await clientMaintenance.end();
  }

  const superutilisateur: IdentifiantsRole = {
    utilisateur: ADMIN_JETABLE_UTILISATEUR,
    motDePasse: ADMIN_JETABLE_MDP,
    url: urlAdmin(nomBase),
  };
  const migrateur: IdentifiantsRole = {
    utilisateur: 'dfa_migrator',
    motDePasse: MDP_MIGRATEUR,
    url: construireUrlJetable(nomBase, 'dfa_migrator', MDP_MIGRATEUR),
  };
  const app: IdentifiantsRole = {
    utilisateur: 'dfa_app',
    motDePasse: MDP_APP,
    url: construireUrlJetable(nomBase, 'dfa_app', MDP_APP),
  };

  // Étape 2 : droits PAR BASE — équivalents des mêmes instructions de 01-roles.sql, rejouées ici
  // parce qu'une base neuve hérite de `template1` (donc du superuser `dfa` comme propriétaire de
  // `public`), jamais des GRANT que 01-roles.sql avait posés sur `dfa_dev` spécifiquement. Sans
  // cette étape, `dfa_migrator` ne pourrait ni créer les tables des migrations ni devenir
  // propriétaire de `public` : la posture RLS attendue par `verifierPostureRls()` ne serait
  // jamais atteinte.
  const clientPosture = new Client({ connectionString: superutilisateur.url });
  await clientPosture.connect();
  try {
    await clientPosture.query(`
      alter schema public owner to dfa_migrator;
      revoke all on schema public from public;
      grant usage on schema public to dfa_migrator;
      grant usage on schema public to dfa_app;
    `);
    await clientPosture.query(`grant create on database "${nomBase}" to dfa_migrator`);
  } finally {
    await clientPosture.end();
  }

  // Étape 3 : migrations avec dfa_migrator, comme en production.
  if (appliquerMigrations) {
    const clientMigrateur = new Client({ connectionString: migrateur.url });
    await clientMigrateur.connect();
    try {
      await appliquerMigrationsUp(clientMigrateur);
    } finally {
      await clientMigrateur.end();
    }
  }

  // Étape 4 : seuls des accès dfa_app / dfa_migrator / superutilisateur sont rendus à l'appelant
  // — même contrat que le backend testcontainers.
  const poolApp = new Pool({ connectionString: app.url, max: 5 });
  const poolMigrateur = new Pool({ connectionString: migrateur.url, max: 3 });
  const poolSuperutilisateur = new Pool({ connectionString: superutilisateur.url, max: 3 });
  await finaliserPools(poolApp, poolMigrateur, poolSuperutilisateur);

  return {
    conteneur: undefined,
    nomBase,
    migrateur,
    app,
    superutilisateur,
    poolApp,
    poolMigrateur,
    poolSuperutilisateur,
    dumperSchema: (roleMigrateur) => dumperSchemaViaDockerExec(nomBase, roleMigrateur),
    async fermer(): Promise<void> {
      // Les pools DOIVENT être fermés avant le DROP DATABASE : une connexion `dfa_app`/
      // `dfa_migrator` encore ouverte empêcherait un DROP ordinaire (« base utilisée par
      // d'autres utilisateurs ») — `WITH (FORCE)` ci-dessous couvre ce cas de toute façon
      // (PostgreSQL 13+, termine les sessions restantes), mais fermer proprement d'abord reste
      // la voie normale, `FORCE` n'est qu'un filet pour un test qui aurait laissé fuiter une
      // connexion.
      await Promise.all([poolApp.end(), poolMigrateur.end(), poolSuperutilisateur.end()]);
      const clientSuppression = new Client({ connectionString: urlAdmin(BASE_MAINTENANCE) });
      await clientSuppression.connect();
      try {
        refuserBaseInterdite(nomBase); // filet ultime, juste avant le DROP effectif.
        await clientSuppression.query(`drop database if exists "${nomBase}" with (force)`);
      } finally {
        await clientSuppression.end();
      }
    },
  };
}

// -------------------------------------------------------------------------------------------
// Migrations : fichiers .sql bruts, appliqués dans l'ordre du nom de fichier. Le mécanisme est
// volontairement indépendant du "journal" interne de drizzle-kit : le contrat gelé (§3) précise
// que le "down" n'a pas d'équivalent natif drizzle et vit dans des fichiers .down.sql écrits à
// la main — on applique donc le même mécanisme simple (lire, trier, exécuter) aux deux sens.
// -------------------------------------------------------------------------------------------

export function listerFichiersMigrationsUp(): string[] {
  if (!existsSync(DOSSIER_MIGRATIONS)) return [];
  return readdirSync(DOSSIER_MIGRATIONS)
    .filter((fichier) => fichier.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

export function listerFichiersMigrationsDown(): string[] {
  if (!existsSync(DOSSIER_MIGRATIONS_DOWN)) return [];
  return readdirSync(DOSSIER_MIGRATIONS_DOWN)
    .filter((fichier) => fichier.endsWith('.down.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

export async function appliquerMigrationsUp(client: Client): Promise<void> {
  const fichiers = listerFichiersMigrationsUp();
  if (fichiers.length === 0) {
    throw new Error(
      `Aucune migration trouvée dans ${DOSSIER_MIGRATIONS}. Soit l'équipe base de données n'a pas ` +
        `encore écrit les migrations de l'étape 0, soit le dossier réel diverge de la ` +
        `convention assumée par ce harnais (voir le commentaire en tête de fichier) — dans ce ` +
        `second cas, ajuster la constante DOSSIER_MIGRATIONS ci-dessus.`,
    );
  }
  for (const fichier of fichiers) {
    const sqlBrut = readFileSync(path.join(DOSSIER_MIGRATIONS, fichier), 'utf8');
    await client.query(sqlBrut);
  }
}

export async function appliquerMigrationsDown(client: Client): Promise<void> {
  // Annulation dans l'ordre INVERSE de l'application : la dernière migration montée doit être
  // la première défaite.
  const fichiers = [...listerFichiersMigrationsDown()].reverse();
  for (const fichier of fichiers) {
    const sqlBrut = readFileSync(path.join(DOSSIER_MIGRATIONS_DOWN, fichier), 'utf8');
    await client.query(sqlBrut);
  }
}

// -------------------------------------------------------------------------------------------
// Introspection de schéma (migrations.spec.ts : up → down → up doit produire un schéma final
// identique). `pg_dump` est exécuté DANS le conteneur (il fait partie de l'image postgres
// officielle) plutôt que depuis l'hôte : ni le poste de dev Windows ni forcément le runner CI
// n'ont `pg_dump` d'installé, alors que le conteneur l'a garanti.
// -------------------------------------------------------------------------------------------

/** Chemin du dump à l'intérieur du conteneur. Réutilisé d'un appel à l'autre (`migrations.spec.ts`
 *  appelle `dumperSchema` deux fois, jamais en parallèle) — chaque appel écrase le précédent. */
const CHEMIN_DUMP_DANS_CONTENEUR = '/tmp/dfa-schema-dump.sql';

async function dumperSchemaViaConteneur(
  conteneur: StartedPostgreSqlContainer,
  roleMigrateur: IdentifiantsRole,
): Promise<string> {
  // `pg_dump -f <fichier>` écrit DANS le conteneur plutôt que sur stdout : le contenu du dump
  // (qui peut contenir des commentaires accentués, ex. compteur_document) ne transite donc
  // JAMAIS par le flux `exec` de testcontainers. C'est volontaire, voir la note de
  // `lireFichierDepuisConteneur` ci-dessous pour la raison précise. Seuls exitCode/stderr
  // (courts, ASCII en pratique) transitent encore par `exec` — sans impact sur l'exactitude du
  // schéma comparé, qui est tout ce que ce test vérifie.
  const resultat = await conteneur.exec(
    [
      'pg_dump',
      '--schema-only',
      '--no-owner',
      '--no-privileges',
      '-U',
      roleMigrateur.utilisateur,
      '-d',
      NOM_BASE,
      '-f',
      CHEMIN_DUMP_DANS_CONTENEUR,
    ],
    { env: { PGPASSWORD: roleMigrateur.motDePasse } },
  );
  const codeSortie = (resultat as { exitCode?: number }).exitCode;
  const sortieErreur = (resultat as { stderr?: string }).stderr ?? '';
  if (codeSortie !== undefined && codeSortie !== 0) {
    throw new Error(`pg_dump a échoué dans le conteneur (code ${codeSortie}) : ${sortieErreur}`);
  }
  const contenuBrut = await lireFichierDepuisConteneur(conteneur, CHEMIN_DUMP_DANS_CONTENEUR);
  return normaliserDumpSchema(contenuBrut.toString('utf8'));
}

/**
 * Équivalent de `dumperSchemaViaConteneur` pour le backend base jetable : pas de conteneur à
 * nous (`docker exec` directement, DEDANS `dfa-postgres`, celui de `pnpm docker:up`) plutôt que
 * l'API `exec()` de testcontainers. Le bug de découpage multi-octets documenté ci-dessous
 * n'existe pas ici : `child_process.execFile` accumule tout `stdout` en interne et ne décode
 * qu'UNE SEULE FOIS sur le buffer complet — jamais chunk par chunk — donc pas besoin du
 * détour par fichier + `copyArchiveFromContainer` + parseur tar. `pg_dump` écrit directement
 * sur stdout ici (`-f` omis), capturé par `execFileAsync`.
 */
async function dumperSchemaViaDockerExec(
  nomBase: string,
  roleMigrateur: IdentifiantsRole,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'docker',
      [
        'exec',
        '-e',
        `PGPASSWORD=${roleMigrateur.motDePasse}`,
        CONTENEUR_DEV_POSTGRES,
        'pg_dump',
        '--schema-only',
        '--no-owner',
        '--no-privileges',
        '-U',
        roleMigrateur.utilisateur,
        '-d',
        nomBase,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    return normaliserDumpSchema(stdout);
  } catch (erreur) {
    throw new Error(
      `[postgres-ephemere][jetable] pg_dump a échoué via \`docker exec ${CONTENEUR_DEV_POSTGRES}\` ` +
        `(pnpm docker:up est-il lancé ?) : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }
}

/**
 * Rapatrie un fichier du conteneur en octets bruts, sans jamais passer par `conteneur.exec()`.
 *
 * Cause du bug corrigé ici (constaté sur `test/integration/migrations.spec.ts`, intermittent —
 * 1 échec sur ~3 selon le diagnostic) : `testcontainers@10.28.0`
 * (`container-runtime/clients/container/docker-container-client.js:206-208`) décode CHAQUE
 * fragment du flux `exec` en UTF-8 séparément (`chunk.toString()`) avant de les concaténer.
 * Quand un caractère multi-octets (ex. `é` = `C3 A9`) tombe pile sur la frontière entre deux
 * événements `data`, chaque moitié se décode seule et se corrompt individuellement — d'où la
 * signature observée : DEUX caractères de remplacement U+FFFD (`EF BF BD EF BF BD`) pour un seul
 * caractère source. Mécanisme reproduit et confirmé à l'identique par
 * `scratchpad/preuve-mecanisme.mjs` (accessible dans les preuves de la tâche). Le bug est dans la
 * dépendance, pas dans nos migrations ni dans le schéma : il ne dépend que du hasard du
 * découpage réseau du flux `exec`, jamais du contenu SQL lui-même.
 *
 * `conteneur.exec(['cat', chemin])` ne serait PAS un correctif : ce serait le même flux `exec`
 * de testcontainers, donc exactement le même risque de coupure — seul le contenu transporté
 * changerait. La voie qui évite réellement le bug est `copyArchiveFromContainer`, qui restitue
 * l'archive tar TELLE QUELLE (flux brut de dockerode, `getArchive`, jamais passé par
 * `chunk.toString()`) : on accumule les fragments en `Buffer` (jamais en `string`) et on ne
 * décode qu'UNE SEULE FOIS, sur le buffer complet — la coupure ne peut alors plus se produire,
 * quelle que soit la façon dont le réseau a fragmenté le flux.
 */
async function lireFichierDepuisConteneur(
  conteneur: StartedPostgreSqlContainer,
  cheminFichier: string,
): Promise<Buffer> {
  // `NodeJS.ReadableStream` type son itérateur asynchrone en `any` (voir @types/node) : rien ne
  // garantit STATIQUEMENT que les fragments sont des `Buffer`. On l'a vérifié en exécution
  // (flux tar de `docker.getArchive()`, jamais reconfiguré en mode "objet"/texte) ; le contrôle
  // ci-dessous transforme une éventuelle rupture de cette hypothèse en échec immédiat et clair,
  // plutôt qu'en décodage silencieusement faux — exactement l'erreur que ce correctif corrige.
  const flux = (await conteneur.copyArchiveFromContainer(
    cheminFichier,
  )) as unknown as AsyncIterable<unknown>;
  const fragments: Buffer[] = [];
  for await (const fragment of flux) {
    if (!Buffer.isBuffer(fragment)) {
      throw new Error(
        `Fragment inattendu du flux d'archive tar (${cheminFichier}) : ${typeof fragment} au ` +
          `lieu de Buffer. testcontainers a peut-être changé de comportement — revoir ce parseur ` +
          `avant de décoder du texte multi-octets à partir de ce flux.`,
      );
    }
    fragments.push(fragment);
  }
  return extraireFichierUniqueDeTar(Buffer.concat(fragments));
}

/**
 * Parseur tar volontairement minimal, restreint au seul cas produit par
 * `copyArchiveFromContainer` d'un chemin de FICHIER (jamais un répertoire) : l'archive `ustar`
 * rendue par `docker.getArchive()` ne contient alors qu'une seule entrée, ce fichier. On lit son
 * en-tête à l'offset 0 (format ustar, POSIX 1003.1-1990 §10.1 — le champ taille, octal ASCII,
 * occupe les octets 124 à 135), puis on retourne exactement ce nombre d'octets de contenu. Ce
 * n'est délibérément PAS un parseur tar généraliste (pas d'entrées multiples, pas de liens, pas
 * de format GNU étendu pour les noms longs) : ajouter ce support serait une source de bugs pour
 * un besoin qui ne se présente jamais ici.
 */
function extraireFichierUniqueDeTar(archive: Buffer): Buffer {
  const TAILLE_ENTETE = 512;
  if (archive.length < TAILLE_ENTETE) {
    throw new Error(
      `Archive tar trop courte pour contenir un en-tête ustar (${archive.length} octets reçus).`,
    );
  }
  const champTaille = archive.subarray(124, 136).toString('ascii').replace(/\0/g, ' ').trim();
  const taille = parseInt(champTaille, 8);
  if (!Number.isFinite(taille) || taille < 0) {
    throw new Error(`Champ de taille tar illisible dans l'en-tête ustar : "${champTaille}".`);
  }
  const debutContenu = TAILLE_ENTETE;
  if (archive.length < debutContenu + taille) {
    throw new Error(
      `Archive tar tronquée : l'en-tête annonce ${taille} octets de contenu, seulement ` +
        `${archive.length - debutContenu} sont disponibles.`,
    );
  }
  return archive.subarray(debutContenu, debutContenu + taille);
}

/** Retire tout ce qui peut varier sans que le SCHÉMA lui-même ait changé (commentaires,
 *  lignes vides, espaces de fin de ligne, méta-commandes psql non déterministes) — pour que la
 *  comparaison up→down→up ne soit pas polluée par du bruit purement cosmétique.
 *
 *  En particulier, pg_dump 18 encadre sa sortie de `\restrict <jeton>` / `\unrestrict <jeton>`
 *  (mécanisme de verrouillage de session psql, sans rapport avec le schéma) où `<jeton>` est
 *  généré aléatoirement À CHAQUE appel de pg_dump — deux dumps du MÊME schéma, produits par
 *  deux appels différents, diffèrent donc toujours sur ces deux lignes si on ne les retire pas.
 *  On les reconnaît par leur mot-clé en tête de ligne, jamais par le jeton lui-même (qui est
 *  justement ce qui varie) : ce filtre ne retire que ces deux méta-commandes précises, aucune
 *  ligne de définition de schéma (CREATE/ALTER/...) ne commence par un backslash. */
export function normaliserDumpSchema(dumpBrut: string): string {
  return dumpBrut
    .split('\n')
    .map((ligne) => ligne.trimEnd())
    .filter((ligne) => ligne.length > 0 && !ligne.startsWith('--'))
    .filter((ligne) => !ligne.startsWith('\\restrict ') && !ligne.startsWith('\\unrestrict '))
    .join('\n');
}

// -------------------------------------------------------------------------------------------
// Utilitaire partagé par les tests RLS : exécute une requête dans une transaction où le GUC
// `app.tenant_id` est posé en portée transaction (`set_config(..., true)`) — EXACTEMENT le
// mécanisme documenté au contrat §3 pour `AccesBase.enTenant`. `tenantId = null` reproduit le
// cas "aucun contexte posé" (fail-closed).
// -------------------------------------------------------------------------------------------

export async function requeteSousTenant<
  T extends Record<string, unknown> = Record<string, unknown>,
>(pool: Pool, tenantId: string | null, texteSql: string, parametres: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (tenantId !== null) {
      await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    }
    const resultat = await client.query(texteSql, parametres);
    return resultat.rows as T[];
  } finally {
    // Toujours annuler : ces requêtes ne doivent jamais laisser de trace, y compris les
    // tentatives d'écriture volontairement invalides (violations RLS attendues).
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
}

// -------------------------------------------------------------------------------------------
// Ajout additif (L1-15, lot 1) — pendant du `requeteSousTenant` ci-dessus pour les cas où PLUSIEURS
// instructions doivent s'exécuter sous le MÊME contexte tenant et laisser une trace persistante
// (fixtures métier `client`/`vehicule`/`ordre_reparation`/`ligne_or` amorcées via le pool `dfa_app`
// — donc soumises au RLS comme n'importe quelle écriture applicative — et tests de machine à états
// qui créent une ligne puis la font transiter). `requeteSousTenant` fait TOUJOURS un rollback : il
// convient aux assertions ponctuelles, pas à la construction d'un jeu de données réutilisé par
// d'autres tests. `ecrireSousTenant` COMMIT si `executer` réussit, ROLLBACK sinon — jamais l'inverse
// implicite d'un throw qui laisserait une transaction ouverte sur une connexion rendue au pool.
// -------------------------------------------------------------------------------------------

export async function ecrireSousTenant<T>(
  pool: Pool,
  tenantId: string,
  executer: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const resultat = await executer(client);
    await client.query('commit');
    return resultat;
  } catch (erreur) {
    await client.query('rollback').catch(() => undefined);
    throw erreur;
  } finally {
    client.release();
  }
}
