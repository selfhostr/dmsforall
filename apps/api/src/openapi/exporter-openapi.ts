/**
 * Script CLI : exporte le document OpenAPI vers `packages/shared/openapi/dfa-openapi.json`,
 * clés triées (diff stable en revue de code), SANS jamais démarrer de serveur HTTP —
 * `NestFactory.create(..., { logger: false })` puis `app.init()`, jamais `listen()`.
 *
 * Exécuté via `pnpm --filter @dfa/api openapi:export` (tsx, pas de build préalable requis).
 */
import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { chargerConfig, chargerFichierEnv, ErreurConfigInvalide } from '../config';
import { construireDocument } from './construire-document';

/** Tri récursif des clés d'un objet JSON — préserve l'ordre des tableaux, trie les objets. */
function trierClesProfondement(valeur: unknown): unknown {
  if (Array.isArray(valeur)) {
    return valeur.map(trierClesProfondement);
  }
  if (valeur !== null && typeof valeur === 'object') {
    const entrees = Object.entries(valeur as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const resultat: Record<string, unknown> = {};
    for (const [cle, sousValeur] of entrees) {
      resultat[cle] = trierClesProfondement(sousValeur);
    }
    return resultat;
  }
  return valeur;
}

async function main(): Promise<void> {
  let config;
  try {
    chargerFichierEnv();
    config = chargerConfig(process.env);
  } catch (erreur) {
    if (erreur instanceof ErreurConfigInvalide) {
      for (const probleme of erreur.problemes) {
        console.error(`  - ${probleme.variable} : ${probleme.message}`);
      }
    }
    process.exitCode = 78;
    return;
  }

  const app = await NestFactory.create(AppModule.pourConfig(config), { logger: false });
  await app.init();

  const document = construireDocument(app, {
    versionApp: config.VERSION_APP,
    cookieNom: config.SESSION_COOKIE_NOM,
  });
  const documentTrie = trierClesProfondement(document);

  const cheminSortie = path.resolve(
    __dirname,
    '../../../../packages/shared/openapi/dfa-openapi.json',
  );
  mkdirSync(path.dirname(cheminSortie), { recursive: true });
  writeFileSync(cheminSortie, `${JSON.stringify(documentTrie, null, 2)}\n`, 'utf8');

  await app.close();
  console.log(`OpenAPI exporté vers ${cheminSortie}`);
}

main().catch((erreur: unknown) => {
  console.error(erreur);
  process.exitCode = 1;
});
