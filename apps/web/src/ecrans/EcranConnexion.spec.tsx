import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranConnexion } from './EcranConnexion';

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<EcranConnexion />} />
          <Route path="/" element={<div>PAGE_ACCUEIL</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function soumettre(email: string, motDePasse: string) {
  const utilisateur = userEvent.setup();
  await utilisateur.type(screen.getByLabelText('Adresse e-mail'), email);
  await utilisateur.type(screen.getByLabelText('Mot de passe'), motDePasse);
  await utilisateur.click(screen.getByRole('button', { name: 'Se connecter' }));
}

describe('EcranConnexion', () => {
  it('sur 401, affiche un message unique et conserve l’e-mail saisi', async () => {
    server.use(
      http.post('/api/v1/auth/connexion', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/AUTH_IDENTIFIANTS_INVALIDES',
            title: 'Identifiants invalides',
            status: 401,
            code: 'AUTH_IDENTIFIANTS_INVALIDES',
            instance: 'req-1',
          },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();
    await soumettre('jean.dupont@garage.ch', 'mauvais-mot-de-passe');

    expect(
      await screen.findByText('Adresse e-mail ou mot de passe incorrect.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Adresse e-mail')).toHaveValue('jean.dupont@garage.ch');
    // Le mot de passe est effacé après échec (hygiène) : le message ne désigne jamais lequel
    // des deux champs est en cause.
    expect(screen.getByLabelText('Mot de passe')).toHaveValue('');
    // Titre propre à la catégorie « identifiants refusés », distinct de « service indisponible ».
    expect(screen.getByText('Identifiants refusés')).toBeInTheDocument();
  });

  it('sur erreur réseau, affiche un message visuellement et textuellement distinct', async () => {
    server.use(http.post('/api/v1/auth/connexion', () => HttpResponse.error()));

    rendre();
    await soumettre('jean.dupont@garage.ch', 'un-mot-de-passe');

    expect(
      await screen.findByText('Vérifiez votre connexion internet, puis réessayez.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Adresse e-mail ou mot de passe incorrect.')).not.toBeInTheDocument();
    // Titre distinct de l'alerte réseau vs l'alerte identifiants.
    expect(screen.getByText('Connexion impossible')).toBeInTheDocument();
  });

  it('sur 500, reste affiché (jamais un écran blanc) et distingue "service indisponible"', async () => {
    server.use(
      http.post(
        '/api/v1/auth/connexion',
        () => new HttpResponse('Internal Server Error', { status: 500 }),
      ),
    );

    rendre();
    await soumettre('jean.dupont@garage.ch', 'un-mot-de-passe');

    // Preuve directe contre l'écran blanc : le formulaire (et donc #root) n'est pas vidé.
    expect(await screen.findByLabelText('Adresse e-mail')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Se connecter' })).toBeInTheDocument();
    // Message distinct de « identifiants invalides » et de « réseau » : le garagiste sait que
    // ce n'est ni sa faute (mot de passe) ni son réseau, mais le service qui est indisponible.
    expect(screen.queryByText('Adresse e-mail ou mot de passe incorrect.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Vérifiez votre connexion internet, puis réessayez.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Identifiants refusés')).not.toBeInTheDocument();
    expect(screen.queryByText('Connexion impossible')).not.toBeInTheDocument();
    // Titre propre à la panne serveur — même vocabulaire que le reste de l'app
    // (`erreurs:serveur.titre`), pour que « service indisponible » veuille toujours dire la même
    // chose, où qu'il apparaisse.
    expect(screen.getByText('Service momentanément indisponible')).toBeInTheDocument();
  });
});
