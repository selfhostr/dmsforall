import '@testing-library/jest-dom/vitest';

import { afterAll, afterEach, beforeAll } from 'vitest';

import { definirEnvPourTests } from '@/config/env';

import { server } from './msw/server';

// La couche api/client.ts lit obtenirEnv() : en test, on l'initialise directement plutôt que
// de dépendre d'un vrai .env (voir aussi test.env dans vitest.config.ts).
definirEnvPourTests({ VITE_API_URL: '/api/v1' });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
