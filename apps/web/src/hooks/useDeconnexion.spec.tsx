import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useDeconnexion } from './useDeconnexion';

function Consommateur() {
  const deconnexion = useDeconnexion();
  return <button onClick={() => deconnexion.mutate()}>Se déconnecter</button>;
}

function rendre() {
  const queryClient = creerQueryClientTest();
  queryClient.setQueryData(['auth', 'me'], { marqueur: 'session-avant-deconnexion' });

  const routeur = createMemoryRouter(
    [
      { path: '/', element: <Consommateur /> },
      { path: '/login', element: <div>PAGE_LOGIN</div> },
    ],
    { initialEntries: ['/'] },
  );

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={routeur} />
    </QueryClientProvider>,
  );

  return { queryClient };
}

describe('useDeconnexion', () => {
  it('purge le cache et redirige même si le serveur ne répond pas (réseau coupé)', async () => {
    server.use(http.post('/api/v1/auth/deconnexion', () => HttpResponse.error()));

    const { queryClient } = rendre();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Se déconnecter' }));

    // Sur une tablette d'atelier partagée, rester connecté parce que le serveur n'a pas
    // répondu serait pire que tout : la redirection doit avoir lieu malgré l'échec réseau.
    expect(await screen.findByText('PAGE_LOGIN')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined();
  });

  it('purge le cache et redirige en cas de succès serveur', async () => {
    server.use(http.post('/api/v1/auth/deconnexion', () => new HttpResponse(null, { status: 204 })));

    const { queryClient } = rendre();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Se déconnecter' }));

    expect(await screen.findByText('PAGE_LOGIN')).toBeInTheDocument();
    expect(queryClient.getQueryData(['auth', 'me'])).toBeUndefined();
  });
});
