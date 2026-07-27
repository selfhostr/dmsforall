import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { creerQueryClientTest } from '@/test/utils';

import { RoutePublique } from './RoutePublique';

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/" element={<div>PAGE_ACCUEIL</div>} />
          <Route
            path="/login"
            element={
              <RoutePublique>
                <div>PAGE_LOGIN</div>
              </RoutePublique>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RoutePublique', () => {
  it('avec une session déjà valide, redirige hors de la page publique (ex. /login)', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre();
    expect(await screen.findByText('PAGE_ACCUEIL')).toBeInTheDocument();
    expect(screen.queryByText('PAGE_LOGIN')).not.toBeInTheDocument();
  });

  it('sans session (401), affiche le contenu public', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json(
          { type: 't', title: 't', status: 401, code: 'AUTH_SESSION_ABSENTE', instance: 'r' },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    expect(await screen.findByText('PAGE_LOGIN')).toBeInTheDocument();
  });
});
