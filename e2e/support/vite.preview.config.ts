import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * Config Vite DÉDIÉE à la prévisualisation e2e du build de production — DISTINCTE de
 * `apps/web/vite.config.ts` (non modifié, hors périmètre de cet outillage). Un seul besoin la
 * justifie : `server.proxy` (utilisé par `pnpm dev`) ne s'applique JAMAIS à `vite preview`
 * (limitation Vite documentée — `preview.proxy` est une clé séparée). Sans elle, le front buildé
 * appelle `/api/v1/...` en relatif contre l'origine de la prévisualisation, où rien ne répond :
 * 404 silencieux, la page se charge mais aucune donnée n'arrive.
 *
 * Choix : un proxy plutôt qu'une build avec VITE_API_URL absolue vers l'API. Deux raisons :
 *   1. Rejouer `en prod, le front est servi derrière le même reverse proxy que l'API, aucun proxy
 *      Vite n'entre en jeu` (commentaire de tête d'`apps/web/vite.config.ts`) — le navigateur
 *      voit une seule origine, exactement la topologie réelle.
 *   2. Zéro CORS : `apps/api/src/main.ts` n'autorise qu'UNE origine (`WEB_URL_PUBLIQUE`, allowlist
 *      stricte, `credentials: true`). Un build à origine différente échouerait la connexion (le
 *      cookie de session ne serait jamais exposé au front). Avec ce proxy, le navigateur ne voit
 *      qu'une requête same-origin vers le port de prévisualisation — la comparaison CORS
 *      côté API ne joue plus aucun rôle, comme derrière un vrai reverse proxy de prod.
 *
 * `DFA_E2E_API_CIBLE` : cible du proxy `/api`, l'API déjà en cours d'exécution sur l'HÔTE
 * (`pnpm dev`/`pnpm dev:api`, port 3000 par défaut — jamais une API démarrée par ce harnais, voir
 * e2e/README.md). Ce process Vite tourne lui-même sur l'hôte (démarré par
 * `e2e/scripts/executer.sh`, jamais dans le conteneur Playwright), donc `localhost` y désigne
 * bien l'hôte — aucune histoire de réseau Docker ici, seulement côté conteneur Playwright -> hôte
 * (voir `e2e/scripts/detecter-ip-hote.sh`).
 */
export default defineConfig({
  root: fileURLToPath(new URL('../../apps/web', import.meta.url)),
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.DFA_E2E_API_CIBLE ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
