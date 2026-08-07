import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { SessionCourante } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { RouteProtegee } from './RouteProtegee';
import { SESSION_TEST } from '@/test/msw/handlers';

function rendre(
  rolesAutorises?: readonly SessionCourante['utilisateur']['role'][],
  redirectionParRole?: Partial<Record<SessionCourante['utilisateur']['role'], string>>,
) {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/login" element={<div>PAGE_LOGIN</div>} />
          <Route path="/destination" element={<div>PAGE_DESTINATION</div>} />
          <Route
            path="/"
            element={
              <RouteProtegee
                rolesAutorises={rolesAutorises}
                redirectionParRole={redirectionParRole}
              >
                <div>CONTENU_PROTEGE</div>
              </RouteProtegee>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RouteProtegee — 4 branches (anti-flash)', () => {
  it('isPending : affiche l’écran de vérification, jamais le contenu ni le login', () => {
    server.use(
      http.get('/api/v1/auth/moi', async () => {
        await delay('infinite');
        return HttpResponse.json(null);
      }),
    );
    rendre();
    expect(screen.queryByText('CONTENU_PROTEGE')).not.toBeInTheDocument();
    expect(screen.queryByText('PAGE_LOGIN')).not.toBeInTheDocument();
  });

  it('isError : affiche « service indisponible », JAMAIS l’écran de login', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.error()));
    rendre();
    expect(await screen.findByText('Service momentanément indisponible')).toBeInTheDocument();
    expect(screen.queryByText('PAGE_LOGIN')).not.toBeInTheDocument();
  });

  it('data===null : redirige vers /login', async () => {
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

  it('data présent : affiche le contenu protégé', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre();
    expect(await screen.findByText('CONTENU_PROTEGE')).toBeInTheDocument();
  });
});

/**
 * `rolesAutorises` — ajout du lot 2 : la route elle-même doit refuser un rôle non autorisé, pas
 * seulement le masquer du menu (`BarreLaterale`). `SESSION_TEST` porte le rôle `chef_atelier`
 * (voir `test/msw/handlers.ts`).
 */
describe('RouteProtegee — rolesAutorises', () => {
  it('rôle absent de `rolesAutorises` : affiche l’écran d’accès refusé, jamais le contenu ni une redirection vers /login', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre(['direction', 'admin']);
    expect(
      await screen.findByText("Vous n'avez pas les droits pour cette action."),
    ).toBeInTheDocument();
    expect(screen.queryByText('CONTENU_PROTEGE')).not.toBeInTheDocument();
    expect(screen.queryByText('PAGE_LOGIN')).not.toBeInTheDocument();
  });

  it('rôle présent dans `rolesAutorises` : affiche le contenu protégé', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre(['chef_atelier', 'direction', 'admin']);
    expect(await screen.findByText('CONTENU_PROTEGE')).toBeInTheDocument();
  });

  it('`rolesAutorises` omis : tout utilisateur authentifié passe (comportement historique inchangé)', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre(undefined);
    expect(await screen.findByText('CONTENU_PROTEGE')).toBeInTheDocument();
  });
});

/**
 * `redirectionParRole` — ajout du Lot 0 de la refonte de navigation
 * (`docs/plan-refonte-navigation.md`) : mécanisme distinct de `rolesAutorises` — le rôle qui
 * matche a bien le droit d'être ici, on choisit seulement de ne jamais lui montrer CET écran-ci.
 * Utilisé en production pour faire atterrir `poste_atelier` sur `/pointage/borne` plutôt que sur
 * `EcranAccueil` (voir `routeur.tsx`, route index). `SESSION_TEST` porte le rôle `chef_atelier`.
 */
describe('RouteProtegee — redirectionParRole', () => {
  it('rôle présent dans `redirectionParRole` : redirige vers la destination dédiée, jamais le contenu ni un accès refusé', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre(undefined, { chef_atelier: '/destination' });
    expect(await screen.findByText('PAGE_DESTINATION')).toBeInTheDocument();
    expect(screen.queryByText('CONTENU_PROTEGE')).not.toBeInTheDocument();
    expect(
      screen.queryByText("Vous n'avez pas les droits pour cette action."),
    ).not.toBeInTheDocument();
  });

  it('rôle absent de `redirectionParRole` : affiche le contenu protégé, comportement inchangé', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre(undefined, { poste_atelier: '/destination' });
    expect(await screen.findByText('CONTENU_PROTEGE')).toBeInTheDocument();
    expect(screen.queryByText('PAGE_DESTINATION')).not.toBeInTheDocument();
  });

  it('`redirectionParRole` omis : comportement historique inchangé, aucune redirection', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    rendre(undefined, undefined);
    expect(await screen.findByText('CONTENU_PROTEGE')).toBeInTheDocument();
  });
});
