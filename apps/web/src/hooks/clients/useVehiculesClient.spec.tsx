import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { server } from '@/test/msw/server';

import { useVehiculesClient } from './useVehiculesClient';

// DÉLIBÉRÉMENT PAS `creerQueryClientTest()` : son `retry: false` par défaut masquerait la
// régression que ce test doit détecter (`useListeCurseur` n'applique la clé `retry` QUE si
// `reessayer` est fourni — sans elle, le défaut du QueryClient jouerait, et un `retry: false` de
// test ferait passer ce test même si `reessayer: useDoitReessayer()` disparaissait du hook). On
// force ici le comportement PAR DÉFAUT réel de TanStack Query (jusqu'à 3 réessais) avec un délai
// nul, pour que la politique testée soit bien celle du hook, pas celle de l'environnement de
// test — `useDoitReessayer()` rejoue justement CE défaut pour tout ce qui n'est pas un refus
// stable (voir `support.ts`), donc un 403 doit rester bloqué à un seul appel même ici.
function enveloppe() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useVehiculesClient', () => {
  // Défaut corrigé : un 403 DROIT_INSUFFISANT est un état STABLE (refus de droit), pas une panne
  // transitoire — TanStack Query réessaie jusqu'à 3 fois par défaut, ce qui martelait le serveur.
  // Ce test échouerait (plus d'un appel) si `retry`/`reessayer` repassait au comportement par
  // défaut — le nombre d'appels est ce qui compte, pas seulement l'état d'erreur affiché.
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
    server.use(http.get('/api/v1/clients/cl-1/vehicules', gestionnaire));

    const { result } = renderHook(() => useVehiculesClient('cl-1'), { wrapper: enveloppe() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    // Laisse le temps à un éventuel réessai planifié de partir avant de compter.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(gestionnaire).toHaveBeenCalledTimes(1);
  });
});
