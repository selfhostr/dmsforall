import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { GardeInstallation, RedirectionVersInstallation } from '@/routes/RouteInstallation';
import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { creerQueryClientTest } from '@/test/utils';

import { EcranPremierGarage } from './EcranPremierGarage';

const PROBLEME = { type: 'x', title: 'x', instance: 'r' };
const MDP = 'Une-Phrase-De-Passe-2026!';

function etat(premierGarageRequis: boolean) {
  server.use(
    http.get('/api/v1/installation/etat', () => HttpResponse.json({ premierGarageRequis })),
  );
}

function rendre(chemin: string) {
  render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter initialEntries={[chemin]}>
        <Routes>
          <Route
            path="/installation"
            element={
              <GardeInstallation>
                <EcranPremierGarage />
              </GardeInstallation>
            }
          />
          <Route
            path="/login"
            element={
              <RedirectionVersInstallation>
                <div>PAGE_LOGIN</div>
              </RedirectionVersInstallation>
            }
          />
          <Route path="/" element={<div>PAGE_ACCUEIL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function remplir(codeInstallation = 'ABCD-EFGH-JKMN', confirmation = MDP) {
  const u = userEvent.setup();
  await u.type(await screen.findByLabelText('Nom du garage'), 'Garage Exemple SA');
  await u.type(screen.getByLabelText('Prénom'), 'Claire');
  await u.type(screen.getByLabelText('Nom'), 'Martin');
  await u.type(screen.getByLabelText('Adresse e-mail'), 'direction@garage-exemple.ch');
  await u.type(screen.getByLabelText('Mot de passe'), MDP);
  await u.type(screen.getByLabelText('Confirmer le mot de passe'), confirmation);
  await u.type(screen.getByLabelText("Code d'installation"), codeInstallation);
  return u;
}

describe('EcranPremierGarage', () => {
  it('instance neuve : la connexion renvoie vers la création du garage', async () => {
    etat(true);
    rendre('/login');
    expect(await screen.findByRole('heading', { name: 'Créer votre garage' })).toBeInTheDocument();
    expect(screen.queryByText('PAGE_LOGIN')).not.toBeInTheDocument();
  });

  it('garage existant : la connexion reste la connexion', async () => {
    etat(false);
    rendre('/login');
    expect(await screen.findByText('PAGE_LOGIN')).toBeInTheDocument();
  });

  it('état illisible : jamais d’écran de création sur un doute, la connexion reste', async () => {
    server.use(http.get('/api/v1/installation/etat', () => HttpResponse.error()));
    rendre('/login');
    expect(await screen.findByText('PAGE_LOGIN')).toBeInTheDocument();
  });

  it('garage existant : la page de création renvoie vers la connexion', async () => {
    etat(false);
    rendre('/installation');
    expect(await screen.findByText('PAGE_LOGIN')).toBeInTheDocument();
  });

  it('montre où lire le code d’installation', async () => {
    etat(true);
    rendre('/installation');
    expect(await screen.findByLabelText("Code d'installation")).toBeInTheDocument();
    expect(screen.getByText('docker compose logs api')).toBeInTheDocument();
  });

  it('refuse deux mots de passe différents sans appeler le serveur', async () => {
    etat(true);
    let appele = false;
    server.use(
      http.post('/api/v1/installation/premier-garage', () => {
        appele = true;
        return HttpResponse.json(SESSION_TEST, { status: 201 });
      }),
    );
    rendre('/installation');
    const u = await remplir('ABCD-EFGH-JKMN', 'Autre-Chose-2026!!');
    await u.click(screen.getByRole('button', { name: 'Créer mon garage' }));
    expect(
      await screen.findByText('Les deux mots de passe ne sont pas identiques.'),
    ).toBeInTheDocument();
    expect(appele).toBe(false);
  });

  it('code refusé : message sous le champ, mots de passe effacés', async () => {
    etat(true);
    server.use(
      http.post('/api/v1/installation/premier-garage', () =>
        HttpResponse.json(
          { ...PROBLEME, status: 403, code: 'INSTALLATION_CODE_INVALIDE' },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre('/installation');
    const u = await remplir();
    await u.click(screen.getByRole('button', { name: 'Créer mon garage' }));
    const messages = await screen.findAllByText(/code d'installation est incorrect ou périmé/i);
    expect(messages.length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Code d'installation")).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('');
    expect(screen.getByLabelText('Confirmer le mot de passe')).toHaveValue('');
  });

  it('mot de passe jugé faible par le serveur : message sous le champ', async () => {
    etat(true);
    server.use(
      http.post('/api/v1/installation/premier-garage', () =>
        HttpResponse.json(
          {
            ...PROBLEME,
            status: 400,
            code: 'VALIDATION_ECHOUEE',
            erreurs: [
              { champ: 'motDePasse', code: 'MOT_DE_PASSE_FAIBLE', message: 'trop courant' },
            ],
          },
          { status: 400, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre('/installation');
    const u = await remplir();
    await u.click(screen.getByRole('button', { name: 'Créer mon garage' }));
    expect(await screen.findByText(/trop faible ou trop courant/i)).toBeInTheDocument();
  });

  it('déjà installé (409) : propose d’aller à la connexion', async () => {
    etat(true);
    server.use(
      http.post('/api/v1/installation/premier-garage', () =>
        HttpResponse.json(
          { ...PROBLEME, status: 409, code: 'INSTALLATION_DEJA_FAITE' },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre('/installation');
    const u = await remplir();
    await u.click(screen.getByRole('button', { name: 'Créer mon garage' }));
    expect(await screen.findByRole('link', { name: 'Aller à la connexion' })).toBeInTheDocument();
  });

  it('succès : envoie la saisie sans la confirmation, puis entre dans l’application', async () => {
    etat(true);
    let corps: unknown;
    server.use(
      http.post('/api/v1/installation/premier-garage', async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json(SESSION_TEST, { status: 201 });
      }),
    );
    rendre('/installation');
    const u = await remplir();
    await u.click(screen.getByRole('button', { name: 'Créer mon garage' }));
    expect(await screen.findByText('PAGE_ACCUEIL')).toBeInTheDocument();
    expect(corps).toEqual({
      codeInstallation: 'ABCD-EFGH-JKMN',
      garage: 'Garage Exemple SA',
      prenom: 'Claire',
      nom: 'Martin',
      email: 'direction@garage-exemple.ch',
      motDePasse: MDP,
    });
  });
});
