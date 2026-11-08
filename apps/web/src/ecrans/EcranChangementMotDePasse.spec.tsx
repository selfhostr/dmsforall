import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { creerQueryClientTest } from '@/test/utils';

import { EcranChangementMotDePasse } from './EcranChangementMotDePasse';

function rendre(session: object | null) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      session
        ? HttpResponse.json(session)
        : HttpResponse.json(
            { type: 'x', title: 'x', status: 401, code: 'AUTH_SESSION_ABSENTE', instance: 'r' },
            { status: 401, headers: { 'content-type': 'application/problem+json' } },
          ),
    ),
  );
  render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter initialEntries={['/changer-mot-de-passe']}>
        <Routes>
          <Route path="/changer-mot-de-passe" element={<EcranChangementMotDePasse />} />
          <Route path="/" element={<div>PAGE_ACCUEIL</div>} />
          <Route path="/login" element={<div>PAGE_LOGIN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const A_CHANGER = { ...SESSION_TEST, motDePasseAChanger: true };

describe('EcranChangementMotDePasse (issue #58)', () => {
  it('sans session : renvoie vers la connexion', async () => {
    rendre(null);
    expect(await screen.findByText('PAGE_LOGIN')).toBeInTheDocument();
  });

  it('sans obligation de changement : renvoie vers l’accueil', async () => {
    rendre({ ...SESSION_TEST, motDePasseAChanger: false });
    expect(await screen.findByText('PAGE_ACCUEIL')).toBeInTheDocument();
  });

  it('refuse deux mots de passe différents sans appeler le serveur', async () => {
    let appele = false;
    server.use(
      http.post('/api/v1/auth/mot-de-passe/changement', () => {
        appele = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    rendre(A_CHANGER);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Mot de passe reçu'), 'temporaire');
    await u.type(screen.getByLabelText('Nouveau mot de passe'), 'Un-Nouveau-Mdp-2026!');
    await u.type(screen.getByLabelText('Confirmer le nouveau mot de passe'), 'Autre-Chose-2026!!');
    await u.click(screen.getByRole('button', { name: 'Enregistrer et continuer' }));
    expect(
      await screen.findByText('Les deux mots de passe ne sont pas identiques.'),
    ).toBeInTheDocument();
    expect(appele).toBe(false);
  });

  it('envoie le changement puis entre dans l’application', async () => {
    let corps: unknown;
    server.use(
      http.post('/api/v1/auth/mot-de-passe/changement', async ({ request }) => {
        corps = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    rendre(A_CHANGER);
    const u = userEvent.setup();
    await u.type(await screen.findByLabelText('Mot de passe reçu'), 'temporaire');
    await u.type(screen.getByLabelText('Nouveau mot de passe'), 'Un-Nouveau-Mdp-2026!');
    await u.type(
      screen.getByLabelText('Confirmer le nouveau mot de passe'),
      'Un-Nouveau-Mdp-2026!',
    );
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({ ...SESSION_TEST, motDePasseAChanger: false }),
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Enregistrer et continuer' }));
    await waitFor(() => expect(screen.getByText('PAGE_ACCUEIL')).toBeInTheDocument());
    expect(corps).toEqual({
      motDePasseActuel: 'temporaire',
      nouveauMotDePasse: 'Un-Nouveau-Mdp-2026!',
    });
  });
});
