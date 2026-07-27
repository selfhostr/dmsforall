import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev : proxy /api -> API NestJS locale (voir contrats-etape-0.md §0). En prod, le front est
// servi derrière le même reverse proxy que l'API, aucun proxy Vite n'entre en jeu.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `@dfa/shared` est résolu vers ses SOURCES TypeScript, pas vers `dist/`.
      //
      // Le paquet est compilé en CommonJS parce que NestJS le consomme ainsi ; Rollup ne peut
      // alors pas extraire ses exports nommés lors du build du front, et `import { LANGUES }`
      // échoue. Publier un double format ESM/CJS résoudrait le symptôme au prix du « dual
      // package hazard » (deux instances des mêmes schémas zod chargées simultanément, dont les
      // comparaisons d'identité échouent silencieusement).
      //
      // Pointer les sources évite les deux : Vite compile le TypeScript, l'élagage reste
      // efficace, et le front comme l'API partagent une seule et même définition. Le typecheck
      // continue de passer par les déclarations de `dist/`, donc le contrat reste vérifié.
      '@dfa/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
  },
});
