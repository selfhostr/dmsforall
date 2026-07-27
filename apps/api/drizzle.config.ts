/**
 * Configuration `drizzle-kit`.
 *
 * IMPORTANT — rôle exact de cet outil dans le projet : les migrations qui font foi sont écrites
 * À LA MAIN dans `src/db/migrations/` et appliquées par `src/db/migrer.ts`. `drizzle-kit` ne
 * génère pas la vérité, il sert à la CONTRÔLER.
 *
 * Pourquoi : le socle contient du SQL que `drizzle-kit generate` ne sait pas produire — RLS,
 * politiques `USING`/`WITH CHECK`, fonctions SECURITY DEFINER, GRANT fins, triggers. Une
 * migration générée serait donc systématiquement incomplète sur ce qui compte le plus.
 *
 * Usage attendu :
 *   - `drizzle-kit generate` écrit dans `src/db/migrations-drizzle/` (répertoire de travail,
 *     jamais appliqué) : le diff produit révèle un éventuel écart entre le schéma TypeScript et
 *     le SQL réellement écrit. Un fichier généré non vide après une migration manuelle = les
 *     deux ont divergé.
 *   - `drizzle-kit studio` pour inspecter la base en développement.
 *
 * Se connecte avec `DATABASE_URL_MIGRATION` : `dfa_app` n'a aucun droit sur le schéma, et c'est
 * précisément ce qu'on veut préserver.
 */

import { defineConfig } from 'drizzle-kit';

import { chargerConfig } from './src/config/charger-config';

// Exception assumée à la règle « aucun fichier ne lit process.env » (contrat §2.7) : cet outil
// s'exécute hors du conteneur d'injection NestJS. Il passe malgré tout par `chargerConfig`,
// donc par la même validation zod que l'API — pas de chemin de configuration parallèle.
const config = chargerConfig(process.env);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',

  // Répertoire de TRAVAIL, distinct de `src/db/migrations/`. Séparation délibérée : un
  // `drizzle-kit generate` lancé par réflexe ne doit jamais pouvoir écraser ou renuméroter une
  // migration écrite à la main, encore moins une déjà appliquée en production.
  out: './src/db/migrations-drizzle',

  dbCredentials: {
    url: config.DATABASE_URL_MIGRATION,
  },

  // Même table de suivi que `migrer.ts`, pour que `drizzle-kit` ne se croie jamais devant une
  // base vierge s'il est lancé par erreur.
  migrations: {
    table: '__dfa_migrations',
    schema: 'public',
  },

  verbose: true,
  strict: true,
});
