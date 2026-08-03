import { defineConfig } from 'vitest/config';

/**
 * Config minimale : `packages/shared` ne contient que des contrats zod/TypeScript, sans
 * décorateurs ni injection de dépendances — pas besoin de la chaîne SWC utilisée par
 * `apps/api/vitest.config.ts`. Un seul profil, les `*.spec.ts` colocalisés dans `src/**`.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'dist/**'],
    environment: 'node',
    restoreMocks: true,
  },
});
