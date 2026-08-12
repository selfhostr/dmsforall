import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ReponseMarquesVehiculesCh } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useMarquesVehicule } from './useMarquesVehicule';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const REPONSE: ReponseMarquesVehiculesCh = {
  marques: [
    { nom: 'Volkswagen', nombreModeles: 42, aliasTrouve: null },
    { nom: 'Volvo', nombreModeles: 18, aliasTrouve: null },
  ],
};

describe('useMarquesVehicule', () => {
  it('interroge `GET /referentiels/vehicules/marques` avec la recherche et une limite compacte', async () => {
    let rechercheRecue: string | null = null;
    let limiteRecue: string | null = null;
    server.use(
      http.get('/api/v1/referentiels/vehicules/marques', ({ request }) => {
        const params = new URL(request.url).searchParams;
        rechercheRecue = params.get('recherche');
        limiteRecue = params.get('limite');
        return HttpResponse.json(REPONSE);
      }),
    );

    const { result } = renderHook(() => useMarquesVehicule('vol', { enabled: true }), {
      wrapper: enveloppe(),
    });

    await waitFor(() => expect(result.current.data).toEqual(REPONSE));
    expect(rechercheRecue).toBe('vol');
    expect(Number(limiteRecue)).toBeGreaterThan(0);
  });

  it('`enabled: false` ne déclenche AUCUNE requête — pas de requête à chaque frappe tant que le champ est temporisé', async () => {
    let appele = false;
    server.use(
      http.get('/api/v1/referentiels/vehicules/marques', () => {
        appele = true;
        return HttpResponse.json(REPONSE);
      }),
    );

    const { result } = renderHook(() => useMarquesVehicule('', { enabled: false }), {
      wrapper: enveloppe(),
    });

    expect(result.current.isPending).toBe(true);
    expect(result.current.fetchStatus).toBe('idle');
    expect(appele).toBe(false);
  });

  it('une panne réseau/serveur se distingue — `isError` remonte, sans planter le rendu', async () => {
    server.use(
      http.get('/api/v1/referentiels/vehicules/marques', () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'Erreur', status: 500, code: 'ERREUR_INTERNE' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useMarquesVehicule('vol', { enabled: true }), {
      wrapper: enveloppe(),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
