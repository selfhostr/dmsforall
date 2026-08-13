import '@testing-library/jest-dom/vitest';

import { configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';

import { definirEnvPourTests } from '@/config/env';

import { server } from './msw/server';

// La couche api/client.ts lit obtenirEnv() : en test, on l'initialise directement plutôt que
// de dépendre d'un vrai .env (voir aussi test.env dans vitest.config.ts).
definirEnvPourTests({ VITE_API_URL: '/api/v1' });

// Délai global pour `findBy*`/`waitFor` (@testing-library/dom), à la place du défaut 1000 ms.
//
// Mesuré le 10.08.2026 sur ce dépôt, machine 16 cœurs : une chaîne complète (requête MSW
// résolue → onSuccess → invalidation de cache → refetch → re-rendu) prend ~1150 ms à vide, mais
// jusqu'à ~4050 ms pour l'assertion la plus lourde une fois les trois suites (shared/api/web) en
// concurrence pour le CPU sous `pnpm test` — la charge que lance la CI. Avant ce correctif, des
// tests indépendants relevaient CHACUN un timeout local à 2000/3000/5000 ms pour la même raison
// (`grep -rn "findBy.*timeout: [0-9]" apps/web/src` en liste plusieurs) : un défaut trop bas pour
// ce dépôt, contourné localement plutôt que corrigé une fois. 5000 ms couvre la pire mesure réelle
// avec ~25 % de marge et laisse un runner CI plus lent que cette machine encore de la marge ;
// couvert par `test.testTimeout` (vitest.config.ts) pour les tests à plusieurs attentes en chaîne.
configure({ asyncUtilTimeout: 5000 });

// `ResizeObserver`, absent de jsdom (comme `AbortController`/`AbortSignal`, corrigé pour une autre
// raison dans `environnementJsdomFetch.ts`) : `useSize` (`@radix-ui/react-use-size`), utilisé par
// le `SelectTrigger` partagé (`components/ui/select.tsx`) pour suivre sa propre largeur, plante au
// montage sans lui — tout `<Select>` rendu en test est concerné, pas seulement ceux qui exercent le
// redimensionnement. Posé une seule fois ici plutôt que redupliqué localement dans chaque spec qui
// monte un `<Select>` (c'était le cas avant ce correctif — voir les specs `ecrans/atelier/*.spec.tsx`
// qui portaient chacune leur propre copie du même stub minimal).
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
