import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const racineMonorepo = fileURLToPath(new URL('../..', import.meta.url));

function executerGit(args: readonly string[], cwd: string): string | undefined {
  try {
    return execFileSync('git', args as string[], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return undefined;
  }
}

function lireVersionPackageJsonWeb(racineDepot: string): string {
  try {
    const brut = readFileSync(join(racineDepot, 'apps/web/package.json'), 'utf-8');
    const version = (JSON.parse(brut) as { version?: string }).version;
    return typeof version === 'string' && version.trim() !== '' ? version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Numéro de version affiché en pied du menu utilisateur (demande produit, 17.08.2026 : « il manque
 * le numéro de version ... implémente-le quelque part de simple dans l'UI, pour le dev »),
 * voir `composants/layout/MenuUtilisateur.tsx`. Calculé UNE SEULE FOIS ici, à la résolution de
 * cette config (démarrage de `pnpm dev` ou `vite build`) — jamais recalculé côté client, aucune
 * trace de `git`/`node:fs` dans le bundle envoyé au navigateur, seule la chaîne déjà calculée
 * l'est (voir `define` plus bas).
 *
 * BUT RÉEL : identifier sans ambiguïté le BUNDLE FRONT réellement servi (« bundle périmé ou vrai
 * défaut ? », doute qui a coûté du temps réel le 16.08.2026 en test à distance). Le numéro de
 * version seul (`apps/web/package.json`) ne suffit pas : il ne bouge pas entre deux commits d'une
 * même journée, exactement le cas qui a fait perdre du temps — d'où le hash court en plus.
 *
 * NE DOIT JAMAIS FAIRE ÉCHOUER LA CONFIG NI LE BUILD : dépôt sans `.git` (archive téléchargée),
 * `git` absent du `PATH`, ou commande qui échoue pour toute autre raison retombent tous sur la
 * chaîne `'inconnu'` — repli honnête (règle maison : absence de donnée ≠ valeur), jamais une
 * exception qui casserait `pnpm dev`/`pnpm build`, jamais une chaîne vide silencieuse qu'on
 * confondrait avec une vraie valeur.
 *
 * Repère `+modifié` : posé quand l'arbre de travail était SALE au moment du build (`git status
 * --porcelain` non vide) — cas nominal en développement, où builder puis regarder l'écran sans
 * avoir commité est la norme, pas l'exception.
 */
function calculerInfoVersionWeb(racineDepot: string): string {
  const version = lireVersionPackageJsonWeb(racineDepot);
  const shaCourt = executerGit(['rev-parse', '--short', 'HEAD'], racineDepot);
  if (shaCourt === undefined) {
    return 'inconnu';
  }
  const statutPorcelain = executerGit(['status', '--porcelain'], racineDepot);
  const modifie = statutPorcelain !== undefined && statutPorcelain !== '';
  return `${version}+${shaCourt}${modifie ? '+modifié' : ''}`;
}

const GROUPES_VENDORS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['vendor-sentry', ['@sentry', '@sentry-internal']],
  ['vendor-react', ['react', 'react-dom', 'scheduler']],
  ['vendor-router', ['react-router', '@remix-run']],
  ['vendor-tanstack', ['@tanstack']],
  ['vendor-formulaires', ['react-hook-form', '@hookform', 'zod']],
  ['vendor-ui', ['@radix-ui', 'radix-ui', '@base-ui', '@floating-ui']],
  ['vendor-i18n', ['i18next', 'react-i18next']],
];

/** Nom du paquet npm d'un chemin `…/node_modules/<paquet>/…` (gère le scope et pnpm). */
function paquetNpm(id: string): string | undefined {
  const marque = '/node_modules/';
  const debut = id.lastIndexOf(marque);
  if (debut === -1) return undefined;
  const segments = id.slice(debut + marque.length).split('/');
  return segments[0]?.startsWith('@') ? `${segments[0]}/${segments[1] ?? ''}` : segments[0];
}

function regrouperVendors(id: string): string | undefined {
  const paquet = paquetNpm(id);
  if (paquet === undefined) return undefined;
  for (const [chunk, paquets] of GROUPES_VENDORS) {
    if (paquets.some((p) => paquet === p || paquet.startsWith(`${p}/`))) return chunk;
  }
  return undefined;
}

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
        "qu'il définit VITE_API_URL — voir README.md « Démarrage » et apps/web/src/config/env.ts.",
    );
  }

  return {
    // Numéro de version (`composants/layout/MenuUtilisateur.tsx`) — remplacement TEXTUEL à la
    // compilation de toute occurrence de `import.meta.env.VITE_DFA_VERSION_INFO` dans le code
    // source par cette chaîne JSON, exactement le mécanisme déjà utilisé par Vite pour les
    // variables `VITE_*` lues depuis `.env` (`envDir` ci-dessous) — ici la valeur ne vient pas
    // d'un fichier mais d'un calcul (voir `calculerInfoVersionWeb`), d'où l'usage explicite de
    // `define` plutôt que `loadEnv`. `vitest.config.ts` est un fichier SÉPARÉ qui ne porte pas ce
    // `define` : sous test, `import.meta.env.VITE_DFA_VERSION_INFO` reste un simple accès de
    // propriété sur l'objet réel `import.meta.env`, donc `undefined` plutôt qu'une exception — le
    // repli défensif de `MenuUtilisateur.tsx` (`typeof … === 'string'`) traite ce cas exactement
    // comme une vraie valeur manquante en production.
    define: {
      'import.meta.env.VITE_DFA_VERSION_INFO': JSON.stringify(
        calculerInfoVersionWeb(racineMonorepo),
      ),
    },
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
        '@dfa/shared': fileURLToPath(
          new URL('../../packages/shared/src/index.ts', import.meta.url),
        ),
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
      rollupOptions: {
        // `@dfa/shared` est résolu vers ses sources par alias (donc hors `node_modules`), et Vite
        // n'y applique pas son `"sideEffects": false`. Sans cette règle, Rollup garde chaque module
        // du barrel (`export *`), donc tous les schémas zod, dans le chunk initial. Chaque module
        // du paquet n'a que des exports purs : un module dont aucun export n'est utilisé est élagué.
        treeshake: {
          moduleSideEffects: (id) => !id.includes('/packages/shared/src/'),
        },
        output: {
          // Vendors stables séparés du code applicatif : leur nom de fichier ne change qu'à la
          // montée de version d'une dépendance, le navigateur les garde en cache d'une livraison
          // à l'autre. `@sentry` n'a volontairement PAS de groupe ici hors de son propre chunk :
          // il n'est atteint que par `import()` (observabilite/sentry.ts) et ne doit jamais être
          // fusionné avec un vendor chargé au premier écran.
          manualChunks: regrouperVendors,
        },
      },
    },
  };
});
