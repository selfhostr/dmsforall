/**
 * Point d'entrée process. Ordre imposé par le contrat gelé étape 0 (§7) :
 *   1. `chargerConfig` — AVANT tout, aucun port ne doit s'ouvrir si la config est invalide ;
 *   2. création de l'app Nest, avec la config déjà validée injectée ;
 *   3. `verifierPostureRls()` — refus de démarrer si le RLS n'est pas dans la posture attendue ;
 *   4. `trust proxy` — nombre EXACT de hops (`TRUST_PROXY_HOPS`), jamais `true` ; posé avant
 *      tout middleware qui lit `req.ip` (limitation de débit, journal de sécurité) ;
 *   5. filtre d'erreurs global (`FiltreProbleme`) ;
 *   6. `cookie-parser` ;
 *   7. CORS, allowlist stricte sur `WEB_URL_PUBLIQUE`, `credentials: true` ;
 *   8. préfixe `api` + versioning URI (`/api/v1/…`) ;
 *   9. Swagger sur `/api/docs` (+ `/api/docs.json`) si `OPENAPI_EXPOSER_DOCS` ;
 *   10. `listen(PORT)`.
 *
 * Étape 4 ajoutée après l'audit sécurité étape 0 (finding 2) : absente, `req.ip` vaut l'adresse
 * TCP entrante derrière un reverse proxy — l'IP du proxy, identique pour tous les tenants —, ce
 * qui transforme la limitation de débit par IP en interrupteur d'arrêt global (une seule clé
 * Redis pour tout le produit) et vide `journal_securite.ip` de toute valeur probante.
 *
 * Avec `apps/api/src/config/charger-config.ts`, ce fichier est le SEUL du dépôt autorisé à
 * lire `process.env`.
 */
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { chargerConfig, chargerFichierEnv, ErreurConfigInvalide } from './config';
import { FiltreProbleme } from './common/erreurs';
import { JETON_DB } from './db/db.jetons';
import type { AccesBase } from './db/db.types';
import { construireDocument } from './openapi';

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
      process.stderr.write('Configuration invalide, l\'API refuse de démarrer :\n');
      for (const probleme of erreur.problemes) {
        process.stderr.write(`  - ${probleme.variable} : ${probleme.message}\n`);
      }
    } else {
      process.stderr.write(`Erreur inattendue au chargement de la configuration : ${String(erreur)}\n`);
    }
    process.exit(CODE_SORTIE_CONFIG_INVALIDE);
  }

  // 2. Création de l'app Nest, config déjà validée injectée via ConfigModule.pourRacine.
  // Typé NestExpressApplication (et non INestApplication) uniquement pour exposer `app.set(…)`,
  // nécessaire à l'étape 4 (`trust proxy`) — l'adaptateur HTTP réel reste Express dans les deux
  // cas, seul le type change.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.pourConfig(config));

  // 3. Posture RLS : fail-closed, mieux vaut une API qui refuse de démarrer qu'une API qui
  // tourne sans isolation tenant effective.
  const acces = app.get<AccesBase>(JETON_DB);
  try {
    await acces.verifierPostureRls();
  } catch (erreur) {
    process.stderr.write(`Posture RLS invalide, l'API refuse de démarrer : ${String(erreur)}\n`);
    await app.close();
    process.exit(1);
  }

  // 4. trust proxy — nombre EXACT de hops, JAMAIS `true` (avec `true`, `X-Forwarded-For` devient
  // entièrement contrôlé par le client : contourne la limitation par IP et empoisonne le
  // journal de sécurité). Défaut 0 (aucun proxy de confiance) tant que TRUST_PROXY_HOPS n'est
  // pas réglé explicitement selon l'infrastructure — voir .env.example.
  app.set('trust proxy', config.TRUST_PROXY_HOPS);

  // 5. Filtre d'erreurs global — application/problem+json partout, y compris les exceptions
  // non typées (jamais de stack exposée au client).
  app.useGlobalFilters(app.get(FiltreProbleme));

  // 6. cookie-parser — GardeSession lit le cookie de session, jamais un header ni un query param.
  app.use(cookieParser());

  // 7. CORS, allowlist stricte (un seul required WEB_URL_PUBLIQUE), jamais `*`.
  app.enableCors({
    origin: [config.WEB_URL_PUBLIQUE],
    credentials: true,
  });

  // 8. Préfixe + versioning URI → toutes les routes en /api/v1/…
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // 9. Swagger — uniquement si explicitement activé (OPENAPI_EXPOSER_DOCS, défaut 'false').
  if (config.OPENAPI_EXPOSER_DOCS) {
    const document = construireDocument(app, {
      versionApp: config.VERSION_APP,
      cookieNom: config.SESSION_COOKIE_NOM,
    });
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs.json' });
  }

  // 10. Écoute.
  await app.listen(config.PORT);
}

main().catch((erreur: unknown) => {
  process.stderr.write(`Échec du démarrage : ${String(erreur)}\n`);
  process.exit(1);
});
