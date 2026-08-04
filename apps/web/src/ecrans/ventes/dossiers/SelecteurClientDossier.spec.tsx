import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { SelecteurClientDossier } from './SelecteurClientDossier';

function rendre() {
  return renduAvecQueryClient(
    <SelecteurClientDossier valeur={null} onChangeValeur={() => {}} libelle="Client" />,
  );
}

describe('SelecteurClientDossier', () => {
  it("une recherche en échec (500) affiche l'état d'erreur, jamais « aucun résultat »", async () => {
    server.use(
      http.get('/api/v1/clients', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Client' }), 'Dupont');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(
      screen.queryByText('Aucun client ne correspond à cette recherche.'),
    ).not.toBeInTheDocument();
  });

  it('une recherche sans résultat affiche bien un état vide (et pas une erreur)', async () => {
    server.use(
      http.get('/api/v1/clients', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );
    rendre();

    await userEvent.setup().type(screen.getByRole('searchbox', { name: 'Client' }), 'Zzzzz');

    expect(
      await screen.findByText('Aucun client ne correspond à cette recherche.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // Défaut 3 corrigé : plus d'appel « toute la première page » au montage, alors que la recherche
  // est vide et que l'UI ne rend rien tant qu'elle l'est (retour `null`, ligne 63).
  it('ne déclenche aucun appel réseau au montage, tant que la recherche est vide', async () => {
    const gestionnaire = vi.fn(() =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
    );
    server.use(http.get('/api/v1/clients', gestionnaire));

    rendre();

    expect(gestionnaire).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
