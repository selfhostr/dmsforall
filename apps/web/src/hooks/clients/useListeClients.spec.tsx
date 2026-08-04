import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ClientResume } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useListeClients } from './useListeClients';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const CLIENT_TEST: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000001',
  nomAffiche: 'Alice Martin',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 0,
  dernierPassageLe: null,
};

describe('useListeClients', () => {
  it('répète `statut` (jamais une liste séparée par virgules) et transmet le tri choisi', async () => {
    let statutsRecus: string[] = [];
    let triRecu: string | null = null;
    server.use(
      http.get('/api/v1/clients', ({ request }) => {
        const params = new URL(request.url).searchParams;
        statutsRecus = params.getAll('statut');
        triRecu = params.get('tri');
        return HttpResponse.json({ donnees: [CLIENT_TEST], curseurSuivant: null, limite: 50 });
      }),
    );

    const { result } = renderHook(
      () => useListeClients({ statut: ['actif', 'bloque'], tri: 'numeroClient:desc' }),
      {
        wrapper: enveloppe(),
      },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(statutsRecus).toEqual(['actif', 'bloque']);
    expect(triRecu).toBe('numeroClient:desc');
  });

  it('enchaîne les pages via fetchNextPage en renvoyant le curseur reçu du serveur', async () => {
    const curseursRecus: (string | null)[] = [];
    server.use(
      http.get('/api/v1/clients', ({ request }) => {
        const curseur = new URL(request.url).searchParams.get('curseur');
        curseursRecus.push(curseur);
        if (!curseur) {
          return HttpResponse.json({
            donnees: [CLIENT_TEST],
            curseurSuivant: 'page-2',
            limite: 50,
          });
        }
        return HttpResponse.json({
          donnees: [{ ...CLIENT_TEST, id: 'cl-2', numeroClient: 'CL-000002' }],
          curseurSuivant: null,
          limite: 50,
        });
      }),
    );

    const { result } = renderHook(() => useListeClients(), { wrapper: enveloppe() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.fetchNextPage();
    });

    await waitFor(() => expect(result.current.data?.pages.length).toBe(2));
    expect(curseursRecus).toEqual([null, 'page-2']);
    expect(result.current.hasNextPage).toBe(false);
  });

  // Défaut 3 corrigé (`SelecteurClientDossier.tsx`) : la recherche vide ne doit pas déclencher
  // d'appel réseau pour toute la première page — `enabled: false` doit rester sans effet sur les
  // appels existants (deux tests ci-dessus, aucune option passée).
  it('enabled: false ne déclenche AUCUNE requête réseau', async () => {
    const gestionnaire = vi.fn(() =>
      HttpResponse.json({ donnees: [CLIENT_TEST], curseurSuivant: null, limite: 50 }),
    );
    server.use(http.get('/api/v1/clients', gestionnaire));

    const { result } = renderHook(() => useListeClients({}, { enabled: false }), {
      wrapper: enveloppe(),
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gestionnaire).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
  });
});
