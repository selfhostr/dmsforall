/**
 * Point d'entrée process. Ordre imposé par le contrat gelé étape 0 (§7) :
 *   1. `chargerConfig` — AVANT tout, aucun port ne doit s'ouvrir si la config est invalide ;
 *   2. création de l'app Nest, avec la config déjà validée injectée ;
 *   3. `verifierPostureRls()` — refus de démarrer si le RLS n'est pas dans la posture attendue ;
 *   4. filtre d'erreurs global (`FiltreProbleme`) ;
 *   5. `cookie-parser` ;
 *   6. CORS, allowlist stricte sur `WEB_URL_PUBLIQUE`, `credentials: true` ;
 *   7. préfixe `api` + versioning URI (`/api/v1/…`) ;
 *   8. Swagger sur `/api/docs` (+ `/api/docs.json`) si `OPENAPI_EXPOSER_DOCS` ;
 *   9. `listen(PORT)`.
 *
 * Avec `apps/api/src/config/charger-config.ts`, ce fichier est le SEUL du dépôt autorisé à
 * lire `process.env`.
 */
import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
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
  const app = await NestFactory.create(AppModule.pourConfig(config));

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

  // 4. Filtre d'erreurs global — application/problem+json partout, y compris les exceptions
  // non typées (jamais de stack exposée au client).
  app.useGlobalFilters(app.get(FiltreProbleme));

  // 5. cookie-parser — GardeSession lit le cookie de session, jamais un header ni un query param.
  app.use(cookieParser());

  // 6. CORS, allowlist stricte (un seul required WEB_URL_PUBLIQUE), jamais `*`.
  app.enableCors({
    origin: [config.WEB_URL_PUBLIQUE],
    credentials: true,
  });

  // 7. Préfixe + versioning URI → toutes les routes en /api/v1/…
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // 8. Swagger — uniquement si explicitement activé (OPENAPI_EXPOSER_DOCS).
  if (config.OPENAPI_EXPOSER_DOCS) {
    const document = construireDocument(app, {
      versionApp: config.VERSION_APP,
      cookieNom: config.SESSION_COOKIE_NOM,
    });
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs.json' });
  }

  // 9. Écoute.
  await app.listen(config.PORT);
}

main().catch((erreur: unknown) => {
  process.stderr.write(`Échec du démarrage : ${String(erreur)}\n`);
  process.exit(1);
});
