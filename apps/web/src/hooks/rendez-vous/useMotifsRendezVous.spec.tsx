import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useMotifsRendezVous } from './useMotifsRendezVous';

function enveloppe() {
  const client = creerQueryClientTest();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useMotifsRendezVous', () => {
  it('actifs: true demande le filtre au serveur (aucun filtre côté client)', async () => {
    const requetes: string[] = [];
    server.use(
      http.get('/api/v1/motifs-rendez-vous', ({ request }) => {
        requetes.push(new URL(request.url).search);
        return HttpResponse.json([{ id: 'm1', actif: true }]);
      }),
    );
    const { result } = renderHook(() => useMotifsRendezVous({ actifs: true }), {
      wrapper: enveloppe(),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(requetes).toEqual(['?actifs=true']);
  });

  it('sans option : tous les motifs, y compris inactifs (paramétrage)', async () => {
    const requetes: string[] = [];
    server.use(
      http.get('/api/v1/motifs-rendez-vous', ({ request }) => {
        requetes.push(new URL(request.url).search);
        return HttpResponse.json([
          { id: 'm1', actif: true },
          { id: 'm2', actif: false },
        ]);
      }),
    );
    const { result } = renderHook(() => useMotifsRendezVous(), { wrapper: enveloppe() });
    await waitFor(() => expect(result.current.data).toHaveLength(2));
    expect(requetes).toEqual(['']);
  });
});
