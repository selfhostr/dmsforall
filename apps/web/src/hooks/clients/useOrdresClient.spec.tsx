import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { server } from '@/test/msw/server';

import { useOrdresClient } from './useOrdresClient';

// DÉLIBÉRÉMENT PAS `creerQueryClientTest()` : son `retry: false` par défaut masquerait la
// régression que ce test doit détecter (`useListeCurseur` n'applique la clé `retry` QUE si
// `reessayer` est fourni). On force ici le comportement PAR DÉFAUT réel de TanStack Query
// (jusqu'à 3 réessais) avec un délai nul, pour que la politique testée soit bien celle du hook.
function enveloppe() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useOrdresClient', () => {
  // Même défaut corrigé que `useVehiculesClient` : un 403 DROIT_INSUFFISANT est un état STABLE,
  // pas une panne transitoire — un réessai automatique martèlerait le serveur pour un rôle qui
  // n'aura jamais ce droit. Le nombre d'appels est ce qui prouve la correction, pas le message
  // affiché.
  it('un 403 DROIT_INSUFFISANT ne déclenche qu’UN SEUL appel réseau (aucun réessai)', async () => {
    const gestionnaire = vi.fn(() =>
      HttpResponse.json(
        {
          type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
          title: 'Droit insuffisant',
          status: 403,
          code: 'DROIT_INSUFFISANT',
          instance: 'req-1',
        },
        { status: 403, headers: { 'content-type': 'application/problem+json' } },
      ),
    );
    server.use(http.get('/api/v1/clients/cl-1/ordres-reparation', gestionnaire));

    const { result } = renderHook(() => useOrdresClient('cl-1'), { wrapper: enveloppe() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(gestionnaire).toHaveBeenCalledTimes(1);
  });
});
