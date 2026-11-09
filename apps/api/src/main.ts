/**
 * Point d'entrée process. Ordre imposé par le contrat gelé étape 0 (§7), complété à l'étape
 * observabilité (Sentry, étape 2 ci-dessous) :
 *   1. `chargerConfig` — AVANT tout, aucun port ne doit s'ouvrir si la config est invalide ;
 *   2. `initialiserSentry` — juste après la config validée (elle porte `SENTRY_DSN`), AVANT la
 *      création de l'app Nest pour instrumenter correctement sa construction ; no-op propre si
 *      `SENTRY_DSN` est absent, ne lève jamais (voir apps/api/src/observabilite) ;
 *   3. création de l'app Nest, avec la config déjà validée injectée ;
 *   4. `verifierPostureRls()` — refus de démarrer si le RLS n'est pas dans la posture attendue ;
 *   5. `trust proxy` — nombre EXACT de hops (`TRUST_PROXY_HOPS`), jamais `true` ; posé avant
 *      tout middleware qui lit `req.ip` (limitation de débit, journal de sécurité) ;
 *   6. filtre d'erreurs global (`FiltreProbleme`) ;
 *   7. `cookie-parser` ;
 *   8. CORS, allowlist stricte sur `WEB_URL_PUBLIQUE`, `credentials: true` ;
 *   9. en-têtes de sécurité HTTP (HSTS/CSP/X-Frame-Options/Referrer-Policy) ;
 *   10. en-têtes de réponse globaux (`Cache-Control`, `X-Content-Type-Options`) ;
 *   11. préfixe `api` + versioning URI (`/api/v1/…`) ;
 *   12. Swagger sur `/api/docs` (+ `/api/docs.json`) si `OPENAPI_EXPOSER_DOCS` ; document CONSOLE
 *       séparé sur `/api/console/docs` en plus, si la console d'exploitation est elle-même allumée
 *       (`DATABASE_URL_CONSOLE` présente — voir `exploitation/config-console.ts`) ;
 *   13. `listen(PORT)`.
 *
 * Étape 5 (ex-étape 4) ajoutée après l'audit sécurité étape 0 (finding 2) : absente, `req.ip`
 * vaut l'adresse TCP entrante derrière un reverse proxy — l'IP du proxy, identique pour tous
 * les tenants —, ce qui transforme la limitation de débit par IP en interrupteur d'arrêt
 * global (une seule clé Redis pour tout le produit) et vide `journal_securite.ip` de toute valeur
 * probante.
 *
 * Étape 10 ajoutée après l'audit sécurité observabilité (finding M5) : sans `Cache-Control:
 * no-store, private`, une réponse contenant des données de session (`GET /auth/moi` — e-mail,
 * nom, sites) peut être écrite en cache disque par le navigateur d'une tablette d'atelier
 * partagée ; l'utilisateur suivant la retrouve via le cache ou le bouton retour, même après
 * déconnexion (la révocation de session ne purge aucun cache HTTP). Posée AVANT le préfixe
 * global pour couvrir toute réponse, y compris Swagger. `X-Content-Type-Options: nosniff` en
 * même temps : coût nul, empêche un navigateur de réinterpréter un corps `application/json`
 * comme un autre type de contenu (défense en profondeur XSS/MIME-sniffing).
 *
 * Étape 9 ajoutée après l'audit sécurité lot 1 (finding H-01) : HSTS, CSP et `X-Frame-Options`
 * étaient absents — voir `apps/api/src/common/securite/en-tetes-securite.middleware.ts` pour le
 * détail (HSTS conditionné à `NODE_ENV === 'production'` ET `req.secure`, CSP scindée entre l'API
 * — `default-src 'none'` — et `/api/docs*`, seule route qui a réellement besoin de charger ses
 * propres scripts/styles pour s'afficher). Posée AVANT le préfixe global, comme l'étape 10, pour
 * couvrir toute réponse.
 *
 * Avec `apps/api/src/config/charger-config.ts`, ce fichier est le SEUL du dépôt autorisé à
 * lire `process.env`.
 */
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { chargerConfig, chargerFichierEnv, ErreurConfigInvalide } from './config';
import { FiltreProbleme } from './common/erreurs';
import { construireMiddlewareEnTetesSecurite } from './common/securite';
import { JETON_DB } from './db/db.jetons';
import type { AccesBase } from './db/db.types';
import { construireDocumentConsole } from './exploitation';
import { construireDocument } from './openapi';
import { initialiserSentry, installerGestionnairesCrash } from './observabilite';

/** Code de sortie standard (`sysexits.h`) pour une configuration invalide. */
const CODE_SORTIE_CONFIG_INVALIDE = 78;

async function main(): Promise<void> {
  // 1. chargerConfig AVANT tout : aucun port ne s'ouvre si la config est invalide.
  let config;
  try {
    chargerFichierEnv();
    config = chargerConfig(process.env);
  } catch (erreur) {
    if (erreur instanceof ErreurConfigInvalide) {
      process.stderr.write('Invalid configuration, the API refuses to start:\n');
      for (const probleme of erreur.problemes) {
        process.stderr.write(`  - ${probleme.variable} : ${probleme.message}\n`);
      }
    } else {
      process.stderr.write(`Unexpected error while loading the configuration: ${String(erreur)}\n`);
    }
    process.exit(CODE_SORTIE_CONFIG_INVALIDE);
  }

  // 2. Initialisation Sentry — juste après la config validée, AVANT la création de l'app Nest.
  // No-op propre si SENTRY_DSN est absent, ne lève jamais (voir observabilite/initialiser-sentry).
  initialiserSentry(config);

  // 2bis. Filet de dernier recours pour les crashs process (uncaughtException/unhandledRejection),
  // hors du cycle requête/réponse — jamais couvert par FiltreProbleme. Câblé APRÈS Sentry : sans
  // quoi la capture n'aurait rien à envoyer (voir observabilite/installer-gestionnaires-crash.ts).
  installerGestionnairesCrash(config);

  // 3. Création de l'app Nest, config déjà validée injectée via ConfigModule.pourRacine.
  // Typé NestExpressApplication (et non INestApplication) uniquement pour exposer `app.set(…)`,
  // nécessaire à l'étape 5 (`trust proxy`) — l'adaptateur HTTP réel reste Express dans les deux
  // cas, seul le type change.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.pourConfig(config));

  // 4. Posture RLS : fail-closed, mieux vaut une API qui refuse de démarrer qu'une API qui
  // tourne sans isolation tenant effective.
  const acces = app.get<AccesBase>(JETON_DB);
  try {
    await acces.verifierPostureRls();
  } catch (erreur) {
    process.stderr.write(`Invalid RLS posture, the API refuses to start: ${String(erreur)}\n`);
    await app.close();
    process.exit(1);
  }

  // 5. trust proxy — nombre EXACT de hops, JAMAIS `true` (avec `true`, `X-Forwarded-For` devient
  // entièrement contrôlé par le client : contourne la limitation par IP et empoisonne le
  // journal de sécurité). Défaut 0 (aucun proxy de confiance) tant que TRUST_PROXY_HOPS n'est
  // pas réglé explicitement selon l'infrastructure — voir .env.example.
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  // 6. Filtre d'erreurs global — application/problem+json partout, y compris les exceptions
  // non typées (jamais de stack exposée au client).
  app.useGlobalFilters(app.get(FiltreProbleme));

  // 7. cookie-parser — GardeSession lit le cookie de session, jamais un header ni un query param.
  app.use(cookieParser());

  // 8. CORS, allowlist stricte (un seul required WEB_URL_PUBLIQUE), jamais `*`.
  app.enableCors({
    origin: [config.WEB_URL_PUBLIQUE],
    credentials: true,
  });

  // 9. En-têtes de sécurité HTTP — AVANT le préfixe pour couvrir toute réponse, y compris
  // Swagger (finding H-01, commentaire de tête de fichier). Voir
  // `common/securite/en-tetes-securite.middleware.ts` pour le détail par en-tête.
  app.use(construireMiddlewareEnTetesSecurite(config));

  // 10. En-têtes de réponse globaux — AVANT le préfixe pour couvrir toute réponse (voir finding
  // M5, commentaire de tête de fichier). `no-store` (pas seulement `no-cache`) : aucune donnée
  // de session ne doit même être écrite sur disque, y compris pour une revalidation ultérieure.
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  // 11. Préfixe + versioning URI → toutes les routes en /api/v1/…
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // 12. Swagger — uniquement si explicitement activé (OPENAPI_EXPOSER_DOCS, défaut 'false').
  if (config.OPENAPI_EXPOSER_DOCS) {
    const document = construireDocument(app, {
      versionApp: config.VERSION_APP,
      cookieNom: config.SESSION_COOKIE_NOM,
    });
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs.json' });

    // 12bis. Document CONSOLE, séparé et servi sur un chemin disjoint — voir
    // exploitation/openapi/construire-document-console.ts pour pourquoi la séparation des deux
    // documents n'est pas négociable (le test de contrat `test/contrat/openapi.spec.ts` interdit
    // tout paramètre "tenantId" dans le document MÉTIER). Monté seulement quand la console est
    // effectivement allumée : sans DATABASE_URL_CONSOLE, ExploitationModule ne porte aucun
    // contrôleur, et exposer quand même une route `/api/console/docs` vide n'apprendrait rien
    // d'utile à un opérateur tout en donnant à un attaquant un signal gratuit sur l'existence du
    // plan console.
    if (config.DATABASE_URL_CONSOLE !== undefined) {
      const documentConsole = construireDocumentConsole(app, {
        versionApp: config.VERSION_APP,
        cookieNom: config.CONSOLE_COOKIE_NOM,
      });
      SwaggerModule.setup('api/console/docs', app, documentConsole, {
        jsonDocumentUrl: 'api/console/docs.json',
      });
    }
  }

  // 13. Écoute.
  await app.listen(config.PORT);
}

main().catch((erreur: unknown) => {
  process.stderr.write(`Échec du démarrage : ${String(erreur)}\n`);
  process.exit(1);
});
