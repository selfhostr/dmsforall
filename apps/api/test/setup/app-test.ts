/**
 * Fabrique une app NestJS de test, câblée sur la base éphémère (voir postgres-ephemere.ts) et
 * un Redis éphémère, avec une configuration surchargeable et une `Horloge` contrôlable pour
 * tester l'expiration de session sans attendre 8 heures.
 *
 * ------------------------------------------------------------------------------------------
 * HYPOTHÈSES D'IMPORT — à confirmer avec expert-nestjs / expert-database / expert-auth à
 * l'intégration. Le contrat gelé (contrats-etape-0.md) fixe les SIGNATURES mais pas toujours
 * le CHEMIN DE FICHIER exact ; ce fichier suppose le pattern barrel `index.ts` par répertoire
 * de module, standard en NestJS. Si un chemin diverge, c'est la SEULE ligne à corriger :
 *
 *   - '../../src/config'        → chargerConfig, ErreurConfigInvalide, ConfigModule, Config
 *   - '../../src/db'            → DbModule, type AccesBase, type ContexteTenant
 *   - '../../src/db/db.jetons'  → JETON_DB, JETON_DB_AMORCAGE (fichier confirmé existant)
 *   - '../../src/app.module'    → AppModule.pourConfig(config: Config): DynamicModule
 *     (hypothèse : main.ts appelle chargerConfig(process.env) puis injecte le résultat dans
 *     la racine du graphe de modules — cf. le motif déjà acté pour ConfigModule.pourRacine au
 *     contrat §2.7 ; aucun autre fichier n'a le droit de lire process.env).
 * ------------------------------------------------------------------------------------------
 */

import cookieParser from 'cookie-parser';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import Redis from 'ioredis';
import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import type { Pool } from 'pg';
import supertest from 'supertest';

import { chargerConfig, ConfigModule, type Config } from '../../src/config';
import { DbModule, type AccesBase } from '../../src/db';
import { FiltreProbleme } from '../../src/common/erreurs';
import { AppModule } from '../../src/app.module';
import { initialiserSentry } from '../../src/observabilite';
import type { BaseEphemere } from './postgres-ephemere';
import { determinerModeEphemere } from './mode-ephemere';

// -----------------------------------------------------------------------------------------
// Horloge de test
// -----------------------------------------------------------------------------------------
//
// Le contrat gelé ne prévoit PAS de jeton d'injection pour une horloge côté ServiceSession
// (pas de `JETON_HORLOGE` au §2.10) : la comparaison "now <= expireLe" décrite au contrat vit
// dans le code applicatif d'expert-auth, hors de portée de ce dépôt de tests (apps/api/test/**
// uniquement). Plutôt que d'inventer une dépendance DI non spécifiée par le contrat — qui
// romprait le découplage propriétaire par répertoire — cette `Horloge` manipule DIRECTEMENT
// les colonnes timestamptz de la table `session` via le rôle `dfa_migrator`.
//
// C'est légitime et pas un contournement : `session` est explicitement exemptée de FORCE ROW
// LEVEL SECURITY (contrat §3), précisément pour que le propriétaire (dfa_migrator) puisse y
// accéder sans contexte tenant — ce qui est le cas ici comme pour les fonctions SECURITY
// DEFINER du schéma `amorcage`. On simule ainsi "une session ouverte il y a N minutes" ou "une
// session dont l'expiration absolue est dépassée" en modifiant l'état stocké, sans jamais avoir
// besoin de contrôler `Date.now()` du process Node — ce qui serait de toute façon insuffisant
// si la comparaison a lieu côté SQL plutôt que côté application.
export class Horloge {
  constructor(private readonly poolMigrateur: Pool) {}

  async fixerExpirationSession(sessionId: string, expireLe: Date): Promise<void> {
    await this.poolMigrateur.query('update session set expire_le = $2 where id = $1', [
      sessionId,
      expireLe,
    ]);
  }

  async fixerDerniereActiviteSession(sessionId: string, vuLe: Date): Promise<void> {
    await this.poolMigrateur.query('update session set vu_le = $2 where id = $1', [
      sessionId,
      vuLe,
    ]);
  }

  async verrouillerUtilisateurJusquA(utilisateurId: string, jusquA: Date | null): Promise<void> {
    await this.poolMigrateur.query('update utilisateur set verrouille_jusqu_a = $2 where id = $1', [
      utilisateurId,
      jusquA,
    ]);
  }
}

// -----------------------------------------------------------------------------------------
// Redis éphémère (nécessaire : la limitation de débit à la connexion, §4 du contrat, passe par
// Redis ; sans conteneur réel, la validation zod de REDIS_URL échouerait ou le comportement
// testé ne correspondrait pas à la production).
// -----------------------------------------------------------------------------------------

export interface RedisEphemere {
  /** Présent UNIQUEMENT en mode testcontainers (voir mode-ephemere.ts) — `undefined` en mode
   *  jetable, qui réutilise la base logique d'un Redis déjà en marche (`pnpm docker:up`,
   *  conteneur `dfa-redis`) au lieu d'en démarrer un à lui. */
  readonly conteneur: StartedTestContainer | undefined;
  readonly url: string;
  fermer(): Promise<void>;
}

export async function demarrerRedisEphemere(): Promise<RedisEphemere> {
  return determinerModeEphemere() === 'jetable'
    ? demarrerRedisEphemereJetable()
    : demarrerRedisEphemereTestcontainers();
}

async function demarrerRedisEphemereTestcontainers(): Promise<RedisEphemere> {
  const conteneur = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();
  const url = `redis://${conteneur.getHost()}:${conteneur.getMappedPort(6379)}`;
  return {
    conteneur,
    url,
    async fermer(): Promise<void> {
      await conteneur.stop();
    },
  };
}

// -----------------------------------------------------------------------------------------
// Redis jetable : le conteneur `dfa-redis` de `pnpm docker:up` est déjà en marche
// (localhost:6379, sans mot de passe, comme .env). Contrairement à Postgres, il n'y a rien à
// "créer" — Redis expose nativement 16 bases logiques numérotées (SELECT 0-15, `save
// databases 16` par défaut, jamais changé ici). L'isolation entre exécutions concurrentes
// passe donc par la RÉSERVATION d'un numéro de base via un verrou `SET ... NX PX` posé dans la
// base 0 (le verrou lui-même n'a pas besoin d'isolation : sa clé est unique par index convoité,
// deux exécutions ne peuvent jamais réserver le MÊME index en même temps). `FLUSHDB` avant usage
// (au cas où un run précédent aurait planté sans nettoyer) et après (propreté, pas une garantie
// absolue si le process est tué brutalement — mêmes limites que testcontainers, qui ne survit
// pas non plus à un `kill -9` du process de test).
// -----------------------------------------------------------------------------------------

const NB_BASES_REDIS_LOGIQUES = 16; // 0 réservée par convention pour l'usage manuel (redis-cli).

function cleVerrouRedisJetable(indice: number): string {
  return `dfa:test:redis-jetable:verrou:${indice}`;
}

async function reserverBaseRedisLogique(admin: Redis): Promise<number> {
  for (let indice = 1; indice < NB_BASES_REDIS_LOGIQUES; indice += 1) {
    // PX 600000 (10 min) : filet en cas de process de test tué sans passer par `fermer()` — le
    // verrou finit par expirer de lui-même plutôt que de condamner l'index pour toujours.
    const obtenu = await admin.set(
      cleVerrouRedisJetable(indice),
      String(process.pid),
      'PX',
      600_000,
      'NX',
    );
    if (obtenu === 'OK') return indice;
  }
  throw new Error(
    `[app-test][jetable] aucune des ${NB_BASES_REDIS_LOGIQUES - 1} bases Redis logiques n'est ` +
      `libre — soit un run précédent a laissé un verrou en attente d'expiration (jusqu'à 10 min), ` +
      `soit ${NB_BASES_REDIS_LOGIQUES - 1} exécutions tournent déjà en parallèle sur cette instance.`,
  );
}

async function demarrerRedisEphemereJetable(): Promise<RedisEphemere> {
  const hote = process.env.DFA_TEST_REDIS_HOTE ?? 'localhost';
  const port = Number(process.env.DFA_TEST_REDIS_PORT ?? 6379);

  const admin = new Redis({ host: hote, port, lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await admin.connect();
  } catch (erreur) {
    admin.disconnect();
    throw new Error(
      `[app-test][jetable] impossible de joindre Redis (${hote}:${port}). \`pnpm docker:up\` ` +
        `a-t-il été lancé ? Cause : ${erreur instanceof Error ? erreur.message : String(erreur)}`,
    );
  }

  let indice: number;
  try {
    indice = await reserverBaseRedisLogique(admin);
  } catch (erreur) {
    admin.disconnect();
    throw erreur;
  }

  const url = `redis://${hote}:${port}/${indice}`;
  const cible = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  await cible.connect();
  await cible.flushdb();
  await cible.quit();

  return {
    conteneur: undefined,
    url,
    async fermer(): Promise<void> {
      const cibleFermeture = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
      try {
        await cibleFermeture.connect();
        await cibleFermeture.flushdb();
      } finally {
        cibleFermeture.disconnect();
      }
      await admin.del(cleVerrouRedisJetable(indice)).catch(() => undefined);
      admin.disconnect();
    },
  };
}

// -----------------------------------------------------------------------------------------
// Construction de la config de test
// -----------------------------------------------------------------------------------------

export function envTest(
  bdd: BaseEphemere,
  redisUrl: string,
  surcharges: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    // Jamais réellement écouté (supertest pilote app.getHttpServer() directement, sans
    // app.listen()) : la valeur doit seulement satisfaire la validation zod (1-65535).
    PORT: '3000',
    API_URL_PUBLIQUE: 'http://localhost:3000',
    WEB_URL_PUBLIQUE: 'http://localhost:5173',
    DATABASE_URL: bdd.app.url,
    DATABASE_URL_MIGRATION: bdd.migrateur.url,
    DATABASE_POOL_MAX: '5',
    DATABASE_TIMEOUT_REQUETE_MS: '10000',
    REDIS_URL: redisUrl,
    SESSION_COOKIE_NOM: 'dfa_session',
    SESSION_DUREE_MINUTES: '480',
    SESSION_INACTIVITE_MINUTES: '120',
    // false en test comme en dev : supertest tape en HTTP clair sur le serveur Nest en mémoire.
    COOKIE_SECURE: 'false',
    ARGON2_MEMOIRE_KIB: '19456',
    ARGON2_ITERATIONS: '2',
    ARGON2_PARALLELISME: '1',
    LIMITE_CONNEXION_IP: '20',
    // Doit rester STRICTEMENT supérieur à SEUIL_VERROUILLAGE_COMPTE (schemaConfig,
    // charger-config.ts) depuis la correction du bloquant B1 (rapport QA étape 0) : sinon
    // `chargerConfig` refuse de démarrer (ErreurConfigInvalide), pour toute app de test, pas
    // seulement pour auth.spec.ts. Valeurs alignées sur les défauts de production.
    LIMITE_CONNEXION_COMPTE: '15',
    SEUIL_VERROUILLAGE_COMPTE: '5',
    LIMITE_FENETRE_SECONDES: '900',
    LOG_NIVEAU: 'fatal',
    OPENAPI_EXPOSER_DOCS: 'true',
    VERSION_APP: '0.0.0-test',
    ...surcharges,
  };
}

export interface AppTest {
  readonly app: INestApplication;
  readonly requete: ReturnType<typeof supertest>;
  readonly config: Config;
  readonly horloge: Horloge;
  readonly poolApp: Pool;
  readonly poolMigrateur: Pool;
  fermer(): Promise<void>;
}

export async function creerAppTest(
  bdd: BaseEphemere,
  redisUrl: string,
  surcharges: Partial<NodeJS.ProcessEnv> = {},
): Promise<AppTest> {
  const config = chargerConfig(envTest(bdd, redisUrl, surcharges));

  // Répliqué depuis main.ts (§7, étape 2) : Sentry doit être initialisé — ou rester un no-op
  // propre si SENTRY_DSN est absent, ce qui est le cas de TOUTE la suite d'intégration sauf
  // observabilite-sentry.spec.ts qui le surcharge explicitement — AVANT la création de l'app,
  // exactement comme en production. Sans cet appel ici, aucun test d'intégration n'exercerait
  // jamais le VRAI chemin d'initialisation/capture Sentry, seulement la fonction de nettoyage
  // testée en isolation (voir observabilite/nettoyer-evenement.spec.ts) — ce qui ne prouve pas
  // qu'elle est réellement branchée sur le chemin qui compte.
  initialiserSentry(config);

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.pourConfig(config)],
  }).compile();

  const app = moduleRef.createNestApplication();
  // Répliqué ici depuis ce que main.ts doit faire (§7 de son commentaire d'en-tête) pour que le
  // cookie de session soit lisible par GardeSession (contrat §2.10 : "lit le cookie ... jamais
  // un header"), pour obtenir le préfixe /api/v1 (contrat §4), et pour que toute `ErreurMetier`
  // (qui n'est PAS une HttpException Nest — voir common/erreurs/erreur-metier.ts) ressorte en
  // application/problem+json avec le bon statut au lieu d'un 500 générique : `FiltreProbleme`
  // est délibérément fourni comme provider ORDINAIRE, pas en APP_FILTER (voir
  // common.module.ts), donc SEUL `app.useGlobalFilters(app.get(FiltreProbleme))` l'active — il
  // n'y a aucun mécanisme automatique qui le fait à notre place. Si main.ts factorise un jour
  // cette configuration dans une fonction exportée (ex. `configurerApplication(app)`), la
  // remplacer ici évite la duplication — pour l'instant les deux copies doivent rester
  // synchronisées manuellement.
  app.useGlobalFilters(app.get(FiltreProbleme));
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  // `defaultVersion: '1'` doit être IDENTIQUE à main.ts : sans lui, un contrôleur qui ne pose pas
  // `@Version()` explicitement (c'est le cas ici, contrat §4 — voir le commentaire en tête
  // d'auth.controller.ts) n'est monté sous AUCUNE version, donc invisible sous /api/v1/... et
  // toute requête de test rend 404 "Cannot POST ..." — un faux négatif qui n'a rien à voir avec
  // le code applicatif testé.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  await app.init();

  return {
    app,
    requete: supertest(app.getHttpServer()),
    config,
    horloge: new Horloge(bdd.poolMigrateur),
    poolApp: bdd.poolApp,
    poolMigrateur: bdd.poolMigrateur,
    async fermer(): Promise<void> {
      // `app.close()` suffit : depuis `common/limitation/redis.provider.ts` (providerRedis),
      // le client `ioredis` du jeton `JETON_REDIS` porte désormais son propre
      // `onModuleDestroy` (quit(), repli disconnect()) — NestJS l'invoque pendant `app.close()`,
      // avant que la promesse ne se résolve. Fermer le client une SECONDE fois ici (ancien
      // correctif, avant que le provider n'ait ce cycle de vie) court-circuitait
      // `providerRedis` : le second `quit()` retombait sur une connexion déjà en train de se
      // fermer et l'écouteur `.on('error', ...)` ajouté au provider rendait ce second échec
      // audible (`Connection is closed.`), faisant échouer `fermer()` — donc l'`afterAll` de
      // chaque fichier d'intégration qui l'appelle. L'ordre reste garanti : le client Redis est
      // fermé PENDANT `app.close()`, donc avant que cette fonction ne retourne et donc avant que
      // l'appelant n'arrête le conteneur Redis éphémère (`RedisEphemere.fermer()`), sans qu'il
      // soit nécessaire de le refaire ici.
      await app.close();
    },
  };
}

/** Instancie uniquement la couche base (ConfigModule + DbModule), sans HTTP, pour les tests qui
 *  veulent exercer directement `AccesBase.enTenant` (ex. rls.spec.ts, test anti-fuite pooling)
 *  sans le coût d'une app HTTP complète. */
export async function creerAccesBaseTest(
  bdd: BaseEphemere,
  redisUrl: string,
  surcharges: Partial<NodeJS.ProcessEnv> = {},
): Promise<{ accesBase: AccesBase; config: Config; fermer: () => Promise<void> }> {
  const config = chargerConfig(envTest(bdd, redisUrl, surcharges));
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.pourRacine(config), DbModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  // Le jeton exact (JETON_DB) est importé séparément dans les specs qui en ont besoin, pour
  // rester au plus près du contrat gelé (Symbol.for('DFA_DB'), fichier confirmé db.jetons.ts).
  const accesBase = app.get<AccesBase>(await importerJetonDb());
  return {
    accesBase,
    config,
    async fermer(): Promise<void> {
      await app.close();
    },
  };
}

async function importerJetonDb(): Promise<symbol> {
  const { JETON_DB } = await import('../../src/db/db.jetons');
  return JETON_DB;
}

// -----------------------------------------------------------------------------------------
// Aides HTTP réutilisées par plusieurs specs (auth.spec.ts, isolation-api.spec.ts).
// -----------------------------------------------------------------------------------------

export interface ReponseHttp {
  readonly status: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
}

export function obtenirEnteteCookie(reponse: ReponseHttp, nomCookie: string): string {
  const brut = reponse.headers['set-cookie'];
  const liste: string[] = Array.isArray(brut) ? brut : brut ? [brut] : [];
  const trouve = liste.find((entree) => entree.startsWith(`${nomCookie}=`));
  if (!trouve) {
    throw new Error(
      `Cookie "${nomCookie}" absent de la réponse (Set-Cookie: ${JSON.stringify(liste)})`,
    );
  }
  return trouve;
}

export function extraireValeurCookie(reponse: ReponseHttp, nomCookie: string): string {
  const brut = obtenirEnteteCookie(reponse, nomCookie);
  const premierSegment = brut.split(';')[0] ?? '';
  return decodeURIComponent(premierSegment.slice(nomCookie.length + 1));
}
