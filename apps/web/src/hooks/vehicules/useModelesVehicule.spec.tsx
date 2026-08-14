import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ReponseModelesVehiculesCh } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useModelesVehicule } from './useModelesVehicule';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const REPONSE: ReponseModelesVehiculesCh = {
  modeles: [
    { nom: 'Golf', codeTypeCh: null },
    { nom: 'Golf GTI', codeTypeCh: '1ZM431' },
  ],
};

describe('useModelesVehicule', () => {
  it('interroge `GET /referentiels/vehicules/modeles` avec la marque et la recherche', async () => {
    let marqueRecue: string | null = null;
    let rechercheRecue: string | null = null;
    server.use(
      http.get('/api/v1/referentiels/vehicules/modeles', ({ request }) => {
        const params = new URL(request.url).searchParams;
        marqueRecue = params.get('marque');
        rechercheRecue = params.get('recherche');
        return HttpResponse.json(REPONSE);
      }),
    );

    const { result } = renderHook(
      () => useModelesVehicule('Volkswagen', 'gol', { enabled: true }),
      { wrapper: enveloppe() },
    );

    await waitFor(() => expect(result.current.data).toEqual(REPONSE));
    expect(marqueRecue).toBe('Volkswagen');
    expect(rechercheRecue).toBe('gol');
  });

  it('`enabled: false` (aucune marque encore saisie) ne déclenche aucune requête — `marque` est obligatoire côté contrat', async () => {
    let appele = false;
    server.use(
      http.get('/api/v1/referentiels/vehicules/modeles', () => {
        appele = true;
        return HttpResponse.json(REPONSE);
      }),
    );

    const { result } = renderHook(() => useModelesVehicule('', '', { enabled: false }), {
      wrapper: enveloppe(),
    });

    expect(result.current.fetchStatus).toBe('idle');
    expect(appele).toBe(false);
  });
});
