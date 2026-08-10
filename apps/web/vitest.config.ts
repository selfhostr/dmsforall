import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // "./src/test/environnementJsdomFetch.ts" plutôt que 'jsdom' directement : voir ce fichier
    // pour le correctif AbortController/AbortSignal nécessaire à fetch()+MSW sous jsdom.
    environment: './src/test/environnementJsdomFetch.ts',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Défaut vitest : 5000 ms. Relevé avec `asyncUtilTimeout` (src/test/setup.ts, voir sa
    // justification) : un test peut enchaîner plusieurs `findBy`/`waitFor`, et sous la charge de
    // `pnpm test` (les trois suites en parallèle) le budget de l'un peut à lui seul approcher les
    // 5000 ms. 15000 ms laisse la place à deux attentes de ce budget plus l'interaction entre les
    // deux, sans devenir un délai indéfini pour un test réellement bloqué.
    testTimeout: 15000,
    // Vitest expose ces variables à la fois sur process.env et import.meta.env pendant les
    // tests : pas de .env réel nécessaire pour que config/env.ts valide correctement.
    env: {
      VITE_API_URL: '/api/v1',
    },
  },
});
