import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const racineMonorepo = fileURLToPath(new URL('../..', import.meta.url));

// Dev : proxy /api -> API NestJS locale (voir contrats-etape-0.md §0). En prod, le front est
// servi derrière le même reverse proxy que l'API, aucun proxy Vite n'entre en jeu.
export default defineConfig(({ mode }) => {
  // Garde-fou : sans ce contrôle, une config manquante (pas de .env, envDir mal réglé) ne se
  // voit qu'au montage React dans le navigateur (écran EcranConfigInvalide) — `pnpm dev`,
  // `pnpm build` et la CI rendent tous un succès en apparence. On fait donc échouer Vite
  // lui-même, en amont, avec le même mécanisme de lecture (`envDir`) que celui utilisé plus
  // bas : si `loadEnv` ne trouve pas VITE_API_URL ici, le navigateur ne le trouvera pas non
  // plus. La validation complète (formats, valeurs vides après trim, etc.) reste la
  // responsabilité exclusive du schéma zod de src/config/env.ts — ce contrôle-ci ne vérifie que
  // la présence, pour rester une vérification de plomberie, pas une deuxième source de vérité.
  const env = loadEnv(mode, racineMonorepo, 'VITE_');
  if (!env.VITE_API_URL || env.VITE_API_URL.trim() === '') {
    throw new Error(
      "Configuration frontend introuvable : VITE_API_URL n'a pas pu être lue depuis " +
        `${racineMonorepo} (envDir de apps/web/vite.config.ts). ` +
        "Vérifier qu'un fichier .env existe à la racine du dépôt (cp .env.example .env) et " +
        'qu\'il définit VITE_API_URL — voir README.md « Démarrage » et apps/web/src/config/env.ts.',
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    // Une seule source de config pour tout le monorepo : le `.env` à la racine (voir
    // `.env.example` racine et la séquence de démarrage dans README.md/CONTRIBUTING.md), pas un
    // second fichier propre à apps/web. Vite ne charge par défaut ses `.env` que depuis son
    // propre répertoire racine (ici apps/web/) ; sans `envDir`, `VITE_API_URL` du `.env` racine
    // n'est jamais lu et le front démarre avec une config invalide (écran EcranConfigInvalide).
    //
    // Aucune fuite de secret : Vite n'expose au bundle client QUE les variables préfixées
    // `VITE_`, quel que soit `envDir` — les secrets non préfixés du `.env` racine (mots de
    // passe base de données, secrets de session, DSN Sentry backend) restent invisibles côté
    // client. Vérifié en exécution (curl du bundle servi + inspection DOM Edge headless).
    envDir: racineMonorepo,
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        // `@dfa/shared` est résolu vers ses SOURCES TypeScript, pas vers `dist/`.
        //
        // Le paquet est compilé en CommonJS parce que NestJS le consomme ainsi ; Rollup ne peut
        // alors pas extraire ses exports nommés lors du build du front, et `import { LANGUES }`
        // échoue. Publier un double format ESM/CJS résoudrait le symptôme au prix du « dual
        // package hazard » (deux instances des mêmes schémas zod chargées simultanément, dont
        // les comparaisons d'identité échouent silencieusement).
        //
        // Pointer les sources évite les deux : Vite compile le TypeScript, l'élagage reste
        // efficace, et le front comme l'API partagent une seule et même définition. Le
        // typecheck continue de passer par les déclarations de `dist/`, donc le contrat reste
        // vérifié.
        '@dfa/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      // `true` : écoute sur 0.0.0.0 en plus de localhost. Nécessaire pour joindre le serveur
      // depuis l'extérieur d'un conteneur (voir docker-compose.dev.yml, dev entièrement
      // conteneurisé) — sans ça, Vite n'écoute que sur loopback et le port publié du conteneur
      // ne mène nulle part. Non cassant pour `pnpm dev` en local : reste joignable via
      // localhost, ajoute seulement d'autres interfaces.
      host: true,
      proxy: {
        '/api': {
          // Cible du proxy `/api` vers l'API NestJS. `http://localhost:3000` par défaut : c'est
          // l'API en Node local (`pnpm dev`), sur le même hôte que ce process Vite. Surchargée
          // UNIQUEMENT par docker-compose.dev.yml (`DFA_DEV_PROXY_API_CIBLE=http://api:3000`) :
          // dans ce cas, ce process Vite tourne lui-même dans un conteneur, où « localhost »
          // désignerait le conteneur web, pas l'API. Lue directement sur `process.env` (le
          // process Node qui exécute ce fichier de config), volontairement PAS via
          // `loadEnv`/`envDir` : ce n'est pas une variable `VITE_*`, elle ne doit jamais être
          // exposée au bundle client (import.meta.env) — c'est un détail de plomberie du
          // serveur de dev, pas une config applicative.
          target: process.env.DFA_DEV_PROXY_API_CIBLE ?? 'http://localhost:3000',
          changeOrigin: true,
        },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});
