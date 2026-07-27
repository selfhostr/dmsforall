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
import path from 'node:path';
import { Client, Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// Module CommonJS : `__dirname` est fourni par le runtime, pas besoin de `import.meta.url`.

// ---------------------------------------------------------------------------------------------
// Constantes de convention. Deux d'entre elles sont des HYPOTHÈSES documentées, à confirmer par
// expert-database à l'intégration (le contrat gelé §3 ne fixe que les NOMS des deux premières
// migrations, pas le dossier qui les contient) :
//   - DOSSIER_MIGRATIONS      : convention drizzle-kit standard (`drizzle/migrations` à la
//                                racine du package). Si expert-database a choisi un autre
//                                dossier, ajuster cette seule constante suffit.
//   - DOSSIER_MIGRATIONS_DOWN : sous-dossier `down/` du même dossier, comme décrit au contrat
//                                ("migrations/down/NNNN_x.down.sql").
// ---------------------------------------------------------------------------------------------

/** Réutilise TEL QUEL le script qui sert aussi en dev (docker-compose.yml) et en prod
 *  (rejoué à la main sur l'instance managée) — c'est le même dispositif de rôles partout,
 *  jamais une redéfinition en dur dans les tests qui pourrait diverger silencieusement. */
const CHEMIN_SCRIPT_ROLES = path.resolve(__dirname, '../../../../docker/postgres/init/01-roles.sql');

const DOSSIER_MIGRATIONS = path.resolve(__dirname, '../../src/db/migrations');
const DOSSIER_MIGRATIONS_DOWN = path.join(DOSSIER_MIGRATIONS, 'down');

const NOM_BASE = 'dfa_test';
const SUPERUTILISATEUR = 'dfa_superutilisateur_test';
const SUPERUTILISATEUR_MDP = 'dfa_superutilisateur_test_mdp';

// Mots de passe repris tels quels de docker/postgres/init/01-roles.sql (valeurs de dev
// explicitement documentées comme non sensibles dans ce fichier — jamais utilisées en prod).
const MDP_MIGRATEUR = 'dfa_migrator_dev';
const MDP_APP = 'dfa_app_dev';

export interface IdentifiantsRole {
  readonly utilisateur: string;
  readonly motDePasse: string;
  readonly url: string;
}

export interface BaseEphemere {
  readonly conteneur: StartedPostgreSqlContainer;
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
  fermer(): Promise<void>;
}

export interface OptionsBaseEphemere {
  /** false : ne PAS appliquer les migrations automatiquement (migrations.spec.ts pilote
   *  lui-même la séquence up → down → up). true par défaut pour tous les autres specs, qui
   *  veulent simplement un schéma prêt à l'emploi. */
  readonly appliquerMigrations?: boolean;
}

export async function demarrerBaseEphemere(options: OptionsBaseEphemere = {}): Promise<BaseEphemere> {
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

  // Vérification de connectivité immédiate : mieux vaut un échec clair ici qu'un timeout
  // mystérieux 100 lignes plus loin dans le premier test qui s'en sert.
  await poolApp.query('select 1');

  return {
    conteneur,
    nomBase: NOM_BASE,
    migrateur,
    app,
    superutilisateur,
    poolApp,
    poolMigrateur,
    poolSuperutilisateur,
    async fermer(): Promise<void> {
      await Promise.all([poolApp.end(), poolMigrateur.end(), poolSuperutilisateur.end()]);
      await conteneur.stop();
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
      `Aucune migration trouvée dans ${DOSSIER_MIGRATIONS}. Soit expert-database n'a pas ` +
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

export async function dumperSchema(conteneur: StartedPostgreSqlContainer, roleMigrateur: IdentifiantsRole): Promise<string> {
  const resultat = await conteneur.exec(
    ['pg_dump', '--schema-only', '--no-owner', '--no-privileges', '-U', roleMigrateur.utilisateur, '-d', NOM_BASE],
    { env: { PGPASSWORD: roleMigrateur.motDePasse } },
  );
  const codeSortie = (resultat as { exitCode?: number }).exitCode;
  const sortieErreur = (resultat as { stderr?: string }).stderr ?? '';
  const sortieStandard = (resultat as { stdout?: string; output?: string }).stdout ?? (resultat as { output?: string }).output ?? '';
  if (codeSortie !== undefined && codeSortie !== 0) {
    throw new Error(`pg_dump a échoué dans le conteneur (code ${codeSortie}) : ${sortieErreur || sortieStandard}`);
  }
  return normaliserDumpSchema(sortieStandard);
}

/** Retire tout ce qui peut varier sans que le SCHÉMA lui-même ait changé (commentaires,
 *  lignes vides, espaces de fin de ligne) — pour que la comparaison up→down→up ne soit pas
 *  polluée par du bruit purement cosmétique. */
export function normaliserDumpSchema(dumpBrut: string): string {
  return dumpBrut
    .split('\n')
    .map((ligne) => ligne.trimEnd())
    .filter((ligne) => ligne.length > 0 && !ligne.startsWith('--'))
    .join('\n');
}

// -------------------------------------------------------------------------------------------
// Utilitaire partagé par les tests RLS : exécute une requête dans une transaction où le GUC
// `app.tenant_id` est posé en portée transaction (`set_config(..., true)`) — EXACTEMENT le
// mécanisme documenté au contrat §3 pour `AccesBase.enTenant`. `tenantId = null` reproduit le
// cas "aucun contexte posé" (fail-closed).
// -------------------------------------------------------------------------------------------

export async function requeteSousTenant<T extends Record<string, unknown> = Record<string, unknown>>(
  pool: Pool,
  tenantId: string | null,
  texteSql: string,
  parametres: unknown[] = [],
): Promise<T[]> {
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
