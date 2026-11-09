/**
 * Point d'entrée process — rôle WORKER (chantier « socle d'ordonnancement — découplage
 * worker/API », 27.08.2026). Miroir partiel de `main.ts` (config, Sentry, filet de crash, posture
 * RLS — étapes identiques, dans le même ordre, pour la même raison), mais SANS jamais exposer le
 * moindre contrôleur métier :
 *
 *   - `AppModule.pourConfig(config)` — LE MÊME graphe qu'en mode API/combiné (mêmes modules,
 *     mêmes contrôleurs déclarés) : c'est `config.MODE_PROCESSUS` qui, À L'INTÉRIEUR de ce
 *     graphe, décide quels bundles de job (`*JobModule.pourConfig`, voir `ordonnancement/
 *     mode-processus.ts`) s'enregistrent réellement — jamais un second graphe maintenu à part ;
 *   - construit via `NestFactory.createApplicationContext`, JAMAIS `NestFactory.create` +
 *     `app.listen()` : aucun adaptateur HTTP Nest/Express n'est même instancié. Les `@Controller`
 *     déclarés par les modules métier importés (clients, atelier, facturation, …) restent de la
 *     MÉTADONNÉE inerte — sans adaptateur HTTP, rien ne les monte sur un routeur, quel que soit
 *     leur nombre. C'est ce qui satisfait l'exigence 2 du chantier (« pas de serveur HTTP, sauf ce
 *     qu'il faut pour la sonde de santé ») SANS avoir à découper `AppModule` en deux graphes ;
 *   - la sonde de santé est un serveur `node:http` BRUT (aucun framework, aucun routeur Nest,
 *     zéro dépendance ajoutée) qui répond UNIQUEMENT `GET /sante` et `GET /sante/pret` — mêmes
 *     garanties que `SanteController` (`sante/sante.controller.ts`), réimplémentées en direct
 *     pour ne dépendre d'AUCUN adaptateur HTTP Nest (celui-ci n'existe justement pas dans ce
 *     process). Le worker doit être supervisable (sonde de vie/disponibilité pour le mainteneur
 *     de conteneurs) sans pour autant ouvrir la moindre route métier : ~40 lignes de `node:http`
 *     l'obtiennent sans réintroduire tout Express/Nest juste pour deux routes.
 *
 * Refuse de démarrer si `MODE_PROCESSUS=api` : ce binaire ne traiterait alors AUCUNE file (aucun
 * bundle de job ne s'enregistre en mode 'api', voir `ordonnancement/mode-processus.ts`) tout en
 * répondant `200 OK` sur sa sonde de vie — un worker silencieusement inutile, indiscernable d'un
 * worker sain depuis l'extérieur. Piège du dépôt (« compile + tests verts, mais ne marche pas ») :
 * mieux vaut un refus explicite au démarrage.
 *
 * Avec `main.ts` et `config/charger-config.ts`, ce fichier est un des seuls du dépôt autorisé à
 * lire `process.env` (via `chargerFichierEnv`/`chargerConfig`, jamais directement).
 */
import 'reflect-metadata';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type Redis from 'ioredis';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JETON_REDIS } from './common/limitation';
import { chargerConfig, chargerFichierEnv, ErreurConfigInvalide } from './config';
import { JETON_DB } from './db/db.jetons';
import type { AccesBase } from './db/db.types';
import { initialiserSentry, installerGestionnairesCrash } from './observabilite';

/** Code de sortie standard (`sysexits.h`) pour une configuration invalide — même convention que
 *  `main.ts`. */
const CODE_SORTIE_CONFIG_INVALIDE = 78;

function envoyerJson(res: ServerResponse, statut: number, corps: unknown): void {
  const donnees = JSON.stringify(corps);
  res.writeHead(statut, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(donnees),
    // Même doctrine que main.ts (finding M5, audit sécurité) : rien de ce process n'est une
    // donnée de session, mais aucune réponse HTTP de ce dépôt n'est mise en cache par défaut.
    'cache-control': 'no-store, private',
  });
  res.end(donnees);
}

async function main(): Promise<void> {
  // 1. chargerConfig AVANT tout — même étape, même raison que main.ts.
  let config;
  try {
    chargerFichierEnv();
    config = chargerConfig(process.env);
  } catch (erreur) {
    if (erreur instanceof ErreurConfigInvalide) {
      process.stderr.write('Invalid configuration, the worker refuses to start:\n');
      for (const probleme of erreur.problemes) {
        process.stderr.write(`  - ${probleme.variable} : ${probleme.message}\n`);
      }
    } else {
      process.stderr.write(`Unexpected error while loading the configuration: ${String(erreur)}\n`);
    }
    process.exit(CODE_SORTIE_CONFIG_INVALIDE);
  }

  // 1bis. Refus explicite si ce binaire est démarré avec le mauvais rôle — voir l'en-tête.
  if (config.MODE_PROCESSUS === 'api') {
    process.stderr.write(
      'MODE_PROCESSUS=api: main-worker would then process no BullMQ queue (see ' +
        'ordonnancement/mode-processus.ts) while answering 200 on its liveness probe, so it refuses ' +
        "to start rather than run a silently useless worker. Use 'worker' or 'combine' " +
        'for this binary, or start apps/api/dist/main.js for the API role.\n',
    );
    process.exit(CODE_SORTIE_CONFIG_INVALIDE);
  }

  // 2. Sentry + filet de crash process — mêmes étapes, même ordre, même raison que main.ts.
  initialiserSentry(config);
  installerGestionnairesCrash(config);

  // 3. Contexte applicatif Nest SANS adaptateur HTTP — voir l'en-tête, § pourquoi ceci suffit à
  // garantir qu'aucune route métier n'est jamais exposée par ce process.
  const app = await NestFactory.createApplicationContext(AppModule.pourConfig(config));
  app.enableShutdownHooks();

  // 4. Posture RLS — même garde-fou fail-closed que main.ts : mieux vaut un worker qui refuse de
  // démarrer qu'un worker qui traite des jobs sans isolation tenant effective.
  const acces = app.get<AccesBase>(JETON_DB);
  try {
    await acces.verifierPostureRls();
  } catch (erreur) {
    process.stderr.write(`Invalid RLS posture, the worker refuses to start: ${String(erreur)}\n`);
    await app.close();
    process.exit(1);
  }

  const redis = app.get<Redis>(JETON_REDIS);

  // 5. Sonde de santé minimale — GET /sante (vie, aucune dépendance vérifiée) et GET /sante/pret
  // (Postgres + Redis, 503 si l'une des deux est indisponible) : MÊME CONTRAT que
  // `SanteController` (`sante/dto/sante.dto.ts`), volontairement réimplémenté en `node:http` brut
  // plutôt que de faire tourner Nest/Express pour deux routes (voir l'en-tête). Toute autre
  // méthode/chemin répond 404 — surface HTTP strictement bornée à la supervision.
  const serveurSante = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET') {
      envoyerJson(res, 405, { statut: 'methode_non_autorisee' });
      return;
    }
    if (req.url === '/sante') {
      envoyerJson(res, 200, {
        statut: 'ok',
        version: config.VERSION_APP,
        branche: config.VERSION_APP_BRANCHE,
      });
      return;
    }
    if (req.url === '/sante/pret') {
      Promise.allSettled([acces.verifierConnexion(), redis.ping()])
        .then(([base, redisPing]) => {
          const baseOk = base.status === 'fulfilled';
          const redisOk = redisPing.status === 'fulfilled';
          envoyerJson(res, baseOk && redisOk ? 200 : 503, {
            base: baseOk ? 'ok' : 'ko',
            redis: redisOk ? 'ok' : 'ko',
          });
        })
        .catch((erreur: unknown) => {
          envoyerJson(res, 503, { statut: 'erreur_inattendue', detail: String(erreur) });
        });
      return;
    }
    envoyerJson(res, 404, { statut: 'introuvable' });
  });

  await new Promise<void>((resolve) => serveurSante.listen(config.PORT, resolve));
  process.stdout.write(
    `Worker démarré (MODE_PROCESSUS=${config.MODE_PROCESSUS}) — sonde de santé sur le port ${String(config.PORT)}.\n`,
  );

  // 6. Arrêt propre — ferme d'abord la sonde HTTP (plus de nouvelles requêtes), puis le contexte
  // Nest (`enableShutdownHooks` ci-dessus déclenche déjà `onModuleDestroy`/`onApplicationShutdown`
  // sur ce même signal, y compris `BullExplorer.onApplicationShutdown` qui ferme chaque `Worker`
  // BullMQ proprement plutôt que de couper les connexions Redis en vol).
  const arreter = async (signal: NodeJS.Signals): Promise<void> => {
    process.stdout.write(`${signal} reçu, arrêt du worker...\n`);
    await new Promise<void>((resolve) => serveurSante.close(() => resolve()));
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void arreter('SIGTERM'));
  process.on('SIGINT', () => void arreter('SIGINT'));
}

main().catch((erreur: unknown) => {
  process.stderr.write(`Worker startup failed: ${String(erreur)}\n`);
  process.exit(1);
});
