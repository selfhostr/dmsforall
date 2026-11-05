import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Deux profils de test, dans un seul fichier de configuration (fonctionnalité "projects" de
 * Vitest 3, qui remplace `vitest.workspace.ts`) :
 *
 *  - "unitaire"    : les `*.spec.ts` colocalisés dans `src/**` (un par répertoire de module,
 *                    à la charge de l'expert propriétaire du répertoire). Aucune dépendance
 *                    Docker, rapides, c'est ce que lance `pnpm test`.
 *  - "integration" : `test/integration/**` et `test/contrat/**` (propriété exclusive
 *                    d'l'équipe tests). Vraie Postgres éphémère via testcontainers — RLS,
 *                    contraintes et rôles font partie du système testé, donc pas de mock de
 *                    base. Lancé UNIQUEMENT par `pnpm test:integration`, jamais par `pnpm test`.
 *
 * apps/api/package.json (propriété l'équipe backend) doit exposer :
 *   "test":            "vitest run --project unitaire"
 *   "test:integration": "vitest run --project integration"
 *   "test:watch":       "vitest --project unitaire"   (confort dev, optionnel)
 *
 * Nécessite vitest ^3 (API `test.projects`).
 *
 * Transpilation SWC (et non esbuild, le défaut de Vite) : esbuild ne supporte pas
 * `emitDecoratorMetadata`, donc sous esbuild `design:paramtypes` n'est jamais émis et Nest ne
 * peut résoudre AUCUNE dépendance injectée par type (`Reflector`, `ServiceContexteRequete`,
 * etc.) — l'injection par jeton (`@Inject(JETON_X)`) fonctionne quand même par hasard, ce qui
 * masque le problème jusqu'à ce qu'un provider injecté par type apparaisse. `unplugin-swc` lit
 * `experimentalDecorators`/`emitDecoratorMetadata` depuis tsconfig.json (déjà activés) et
 * remplace entièrement la transformation esbuild pour les fichiers .ts. Appliqué aux deux
 * projets : "integration" en a besoin pour démarrer l'app Nest réelle ; "unitaire" doit rester
 * cohérent avec la même chaîne de transpilation (des specs unitaires instancient aussi des
 * providers via Nest testing module) et ne doit pas régresser avec ce changement.
 */
const pluginSwc = swc.vite({ module: { type: 'es6' } });

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [pluginSwc],
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
        plugins: [pluginSwc],
        test: {
          name: 'integration',
          // 'test/lot1/**' (additif, L1-15) : périmètre exclusif d'l'équipe tests pour le lot 1
          // (fixtures + intégration + contrat), voir plan-lot1-execution.md §7.1. Aucun autre
          // lot ne possède ce fichier ; l'ajout est la seule façon de faire tourner ces
          // specs sous `pnpm test:integration` sans dupliquer test/integration/ ou test/contrat/.
          include: [
            'test/integration/**/*.spec.ts',
            'test/contrat/**/*.spec.ts',
            'test/lot1/**/*.spec.ts',
            // 'test/lot2/**' : périmètre du lot 2 (Pointage, Pièces) — isolation multi-tenant et
            // agrégats métier, jusqu'ici écrits mais jamais collectés par ce projet (oubli).
            'test/lot2/**/*.spec.ts',
          ],
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
