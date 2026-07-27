import { defineConfig } from 'vitest/config';

/**
 * Deux profils de test, dans un seul fichier de configuration (fonctionnalité "projects" de
 * Vitest 3, qui remplace `vitest.workspace.ts`) :
 *
 *  - "unitaire"    : les `*.spec.ts` colocalisés dans `src/**` (un par répertoire de module,
 *                    à la charge de l'expert propriétaire du répertoire). Aucune dépendance
 *                    Docker, rapides, c'est ce que lance `pnpm test`.
 *  - "integration" : `test/integration/**` et `test/contrat/**` (propriété exclusive
 *                    d'expert-tests). Vraie Postgres éphémère via testcontainers — RLS,
 *                    contraintes et rôles font partie du système testé, donc pas de mock de
 *                    base. Lancé UNIQUEMENT par `pnpm test:integration`, jamais par `pnpm test`.
 *
 * apps/api/package.json (propriété expert-nestjs) doit exposer :
 *   "test":            "vitest run --project unitaire"
 *   "test:integration": "vitest run --project integration"
 *   "test:watch":       "vitest --project unitaire"   (confort dev, optionnel)
 *
 * Nécessite vitest ^3 (API `test.projects`).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unitaire',
          include: ['src/**/*.spec.ts'],
          exclude: ['**/node_modules/**', 'test/**', 'dist/**'],
          environment: 'node',
          testTimeout: 5_000,
          hookTimeout: 5_000,
          restoreMocks: true,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.spec.ts', 'test/contrat/**/*.spec.ts'],
          exclude: ['**/node_modules/**', 'dist/**'],
          environment: 'node',
          // Démarrage de conteneur + migrations peuvent prendre du temps sur un poste de dev
          // ou un runner CI froid (pull d'image compris) : délais volontairement larges.
          testTimeout: 120_000,
          hookTimeout: 180_000,
          teardownTimeout: 60_000,
          // Un seul worker, fichiers exécutés en séquence. Chaque fichier de spec démarre son
          // propre conteneur Postgres éphémère (beforeAll) et manipule des objets globaux à la
          // base (rôles, politiques RLS, schéma amorçage) : la concurrence entre fichiers
          // casserait précisément l'isolation qu'on est en train de prouver, et ferait
          // grimper la consommation Docker en CI sans bénéfice réel (les tests d'intégration
          // ne sont de toute façon pas censés être nombreux — cf. CONTRIBUTING.md, tests
          // d'intégration = base réelle, pas la majorité de la suite).
          fileParallelism: false,
          pool: 'forks',
          poolOptions: {
            forks: {
              singleFork: true,
            },
          },
        },
      },
    ],
  },
});
