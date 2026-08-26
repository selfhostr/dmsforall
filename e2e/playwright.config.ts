import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

/** Session déjà authentifiée, écrite une seule fois par le projet `authentification` (voir
 *  `specs/authentification.setup.ts`) et réutilisée par tous les specs qui n'ont pas besoin de
 *  rejouer le formulaire de connexion — un seul login pour toute la suite plutôt qu'un par test,
 *  moins de trajets réseau donc moins de surface de flakiness (§5 de la mission : stabilité avant
 *  exhaustivité). `connexion.spec.ts` seul reste hors de ce mécanisme : c'est justement le
 *  formulaire de connexion qu'il exerce. Chemin absolu (pas de dépendance au `cwd` du process qui
 *  lance `playwright test`, différent selon qu'on l'appelle depuis la racine ou depuis e2e/). */
const FICHIER_ETAT_AUTHENTIFIE = fileURLToPath(
  new URL('./.auth/utilisateur.json', import.meta.url),
);

/**
 * Harnais e2e DFA — exécuté DANS l'image Docker officielle `mcr.microsoft.com/playwright:v1.62.1-
 * jammy` (voir e2e/scripts/executer.sh), jamais sur ce poste directement : les bibliothèques
 * système manquent ici pour lancer Chromium (mesuré, voir e2e/README.md). La version de
 * `@playwright/test` (package.json racine) DOIT rester alignée sur le tag d'image — un décalage
 * driver/navigateur casse silencieusement des API récentes.
 *
 * Aucun `webServer` déclaré ici volontairement : le serveur cible (dev déjà lancé par @laupernoe, ou
 * build+preview démarrés par `e2e/scripts/demarrer-cible-build.sh`) tourne sur l'HÔTE, jamais
 * dans le conteneur qui exécute ce fichier — `webServer` de Playwright lancerait sa commande
 * DANS le conteneur, où `pnpm`/le dépôt buildé ne sont pas dans le même état que sur l'hôte.
 * L'orchestration (build, démarrage, attente de disponibilité, arrêt) vit dans
 * `e2e/scripts/executer.sh`, appelé AVANT `docker run`. Ce fichier attend seulement `BASE_URL`
 * déjà prêt.
 */
const baseURL = process.env.BASE_URL;
if (!baseURL) {
  throw new Error(
    'BASE_URL manquant. Ne pas lancer `playwright test` directement — passer par ' +
      '`pnpm e2e` (cible build) ou `pnpm e2e:dev` (cible dev), qui calculent BASE_URL ' +
      "(IP LAN de l'hôte, voir e2e/scripts/detecter-ip-hote.sh) et démarrent le serveur cible.",
  );
}

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Aucune retentative par défaut : la mission explicite est de PROUVER la stabilité sur trois
  // exécutions consécutives (voir e2e/README.md « Preuve de stabilité ») — une retentative qui
  // repêche un test flaky masquerait exactement ce qu'on cherche à mesurer. `PW_RETRIES`
  // reste un échappatoire assumé (jamais utilisé pour la preuve de stabilité elle-même).
  retries: process.env.PW_RETRIES ? Number(process.env.PW_RETRIES) : 0,
  // Machine partagée avec d'autres agents/process (voir hygiène CONTRIBUTING.md) : workers borné plutôt
  // que le défaut (nombre de coeurs), qui saturerait la machine à chaque run.
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 2,
  reporter: [['list'], ['html', { outputFolder: './playwright-report', open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    // `--ipc=host` déjà posé au `docker run` (voir executer.sh) pour la stabilité de Chromium ;
    // `colorScheme` piloté explicitement par chaque test qui bascule le thème (jamais hérité de
    // l'OS du conteneur), voir e2e/support/theme.ts.
  },
  projects: [
    {
      name: 'authentification',
      testMatch: /authentification\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'anonyme',
      testMatch: /connexion\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium',
      testIgnore: /connexion\.spec\.ts/,
      dependencies: ['authentification'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: FICHIER_ETAT_AUTHENTIFIE,
      },
    },
  ],
});
