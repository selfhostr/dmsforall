import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { clesQuery } from '@/api/cles';
import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { creerQueryClientTest } from '@/test/utils';

import { useConnexion } from './useConnexion';

const CLE_RESIDU_TENANT_PRECEDENT = ['residu-tenant-precedent'] as const;

function Consommateur() {
  const connexion = useConnexion();
  return (
    <button onClick={() => connexion.mutate({ email: 'jean.dupont@garage.ch', motDePasse: 'secret' })}>
      Connecter
    </button>
  );
}

describe('useConnexion', () => {
  it('purge le cache (clear) AVANT de le remplir (fetchQuery) AVANT de naviguer', async () => {
    server.use(http.post('/api/v1/auth/connexion', () => HttpResponse.json(SESSION_TEST)));

    const queryClient = creerQueryClientTest();
    // Simule un résidu de cache d'un tenant précédent sur un poste partagé.
    queryClient.setQueryData(CLE_RESIDU_TENANT_PRECEDENT, 'donnee-tenant-precedent');

    const clearSpy = vi.spyOn(queryClient, 'clear');
    const fetchQuerySpy = vi.spyOn(queryClient, 'fetchQuery');

    const routeur = createMemoryRouter(
      [
        { path: '/login', element: <Consommateur /> },
        { path: '/', element: <div>PAGE_ACCUEIL</div> },
      ],
      { initialEntries: ['/login'] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={routeur} />
      </QueryClientProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Connecter' }));

    expect(await screen.findByText('PAGE_ACCUEIL')).toBeInTheDocument();

    // Ordre strict : clear() appelé avant fetchQuery().
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(fetchQuerySpy).toHaveBeenCalledTimes(1);
    expect(clearSpy.mock.invocationCallOrder[0]!).toBeLessThan(fetchQuerySpy.mock.invocationCallOrder[0]!);

    // Le résidu du tenant précédent n'a pas survécu ; le cache contient la nouvelle session.
    expect(queryClient.getQueryData(CLE_RESIDU_TENANT_PRECEDENT)).toBeUndefined();
    expect(queryClient.getQueryData(clesQuery.session())).toEqual(SESSION_TEST);
  });

  it('navigue vers state.from si présent plutôt que vers /', async () => {
    server.use(http.post('/api/v1/auth/connexion', () => HttpResponse.json(SESSION_TEST)));
    const queryClient = creerQueryClientTest();

    const routeur = createMemoryRouter(
      [
        { path: '/login', element: <Consommateur /> },
        { path: '/atelier', element: <div>PAGE_ATELIER</div> },
      ],
      { initialEntries: [{ pathname: '/login', state: { from: '/atelier' } }] },
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={routeur} />
      </QueryClientProvider>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Connecter' }));

    await waitFor(() => expect(screen.getByText('PAGE_ATELIER')).toBeInTheDocument());
  });
});
