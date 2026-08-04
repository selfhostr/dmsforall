import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranNouvelleCommandeFournisseur } from './EcranNouvelleCommandeFournisseur';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/commandes-fournisseur/nouvelle']}>
        <Routes>
          <Route
            path="/pieces/commandes-fournisseur/nouvelle"
            element={<EcranNouvelleCommandeFournisseur />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Preuve du défaut 2 corrigé : l'écran ne destructurait que `fournisseurs` (`[]` par défaut) —
 * un chargement lent ou un échec laissait le Select vide sans explication, l'utilisateur restait
 * bloqué sans savoir pourquoi. `isPending`/`isError` doivent maintenant être traités
 * explicitement, avec les composants d'état déjà en place ailleurs dans le dépôt.
 */
describe('EcranNouvelleCommandeFournisseur — chargement des fournisseurs', () => {
  it('affiche un état de chargement explicite tant que les fournisseurs ne sont pas arrivés (jamais un Select vide sans explication)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get(
        '/api/v1/fournisseurs',
        () => new Promise(() => {}), // ne répond jamais dans ce test : reste en chargement
      ),
    );

    rendre();

    await screen.findByRole('heading', { name: 'Créer une commande' });
    // Le Select fournisseur n'est pas rendu tant que le chargement n'est pas terminé — pas de
    // combobox vide qui donnerait l'illusion « aucun fournisseur ».
    expect(screen.queryByRole('combobox', { name: 'Fournisseur' })).not.toBeInTheDocument();
    expect(document.querySelector('[role="status"]')).toBeTruthy();
  });

  it('affiche un état erreur actionnable (retry) si le chargement des fournisseurs échoue', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () =>
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

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Impossible d'afficher les fournisseurs")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Fournisseur' })).not.toBeInTheDocument();
  });

  it('affiche le Select fournisseur une fois la liste chargée avec succès', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () =>
        HttpResponse.json({
          donnees: [
            {
              id: 'fourn-1',
              nom: 'Bosch',
              statut: 'actif',
              email: null,
              telephone: null,
              delaiHabituelJours: null,
              creeLe: '2026-01-01T08:00:00.000Z',
              modifieLe: '2026-01-01T08:00:00.000Z',
            },
          ],
          curseurSuivant: null,
          limite: 200,
        }),
      ),
    );

    rendre();

    expect(await screen.findByRole('combobox', { name: 'Fournisseur' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
