import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useRendezVousAutresSites } from './useRendezVousAutresSites';

function enveloppe() {
  const client = creerQueryClientTest();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useRendezVousAutresSites', () => {
  it('UN appel resume-sites pour tous les sites, le site courant est écarté', async () => {
    const appels: URL[] = [];
    server.use(
      http.get('/api/v1/rendez-vous/resume-sites', ({ request }) => {
        appels.push(new URL(request.url));
        return HttpResponse.json([
          { siteId: 'sion', nombre: 9 },
          { siteId: 'martigny', nombre: 3 },
          { siteId: 'sierre', nombre: 0 },
        ]);
      }),
    );
    const { result } = renderHook(
      () =>
        useRendezVousAutresSites(
          [
            { id: 'sion', nom: 'Sion' },
            { id: 'martigny', nom: 'Martigny' },
            { id: 'sierre', nom: 'Sierre' },
          ],
          'sion',
          { du: '2026-11-09', au: '2026-11-15' },
        ),
      { wrapper: enveloppe() },
    );
    await waitFor(() => expect(result.current[0]?.total).toBe(3));
    expect(result.current).toEqual([
      { siteId: 'martigny', nom: 'Martigny', total: 3 },
      { siteId: 'sierre', nom: 'Sierre', total: 0 },
    ]);
    expect(appels).toHaveLength(1);
    expect(appels[0]?.searchParams.get('du')).toBe('2026-11-09');
    expect(appels[0]?.searchParams.get('au')).toBe('2026-11-15');
  });

  it('ne charge rien tant que le site courant est inconnu, ni pour un garage mono-site', async () => {
    let appels = 0;
    server.use(
      http.get('/api/v1/rendez-vous/resume-sites', () => {
        appels += 1;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(
      () =>
        useRendezVousAutresSites([{ id: 'sion', nom: 'Sion' }], undefined, { du: 'a', au: 'b' }),
      { wrapper: enveloppe() },
    );
    const mono = renderHook(
      () => useRendezVousAutresSites([{ id: 'sion', nom: 'Sion' }], 'sion', { du: 'a', au: 'b' }),
      { wrapper: enveloppe() },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current).toEqual([]);
    expect(mono.result.current).toEqual([]);
    expect(appels).toBe(0);
  });
});
