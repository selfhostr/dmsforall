import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseFournisseur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeFournisseurs } from './EcranListeFournisseurs';

// Radix Select appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même stub que
// `EcranFicheVehicule.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const FOURNISSEUR: ReponseFournisseur = {
  id: 'fourn-1',
  nom: 'Bosch Service SA',
  email: 'commandes@bosch-service.ch',
  telephone: '+41791234567',
  delaiHabituelJours: 2,
  statut: 'actif',
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-01T08:00:00.000Z',
};

function pageDe(donnees: readonly ReponseFournisseur[]): PageCurseur<ReponseFournisseur> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/fournisseurs']}>
        <Routes>
          <Route path="/pieces/fournisseurs" element={<EcranListeFournisseurs />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeFournisseurs', () => {
  it('affiche les fournisseurs actifs par défaut', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () => HttpResponse.json(pageDe([FOURNISSEUR]))),
    );

    rendre();

    expect(await screen.findByText('Bosch Service SA')).toBeInTheDocument();
    expect(screen.getByText('commandes@bosch-service.ch')).toBeInTheDocument();
  });

  it('état vide : invite à créer le premier fournisseur, sans filtre actif', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(await screen.findByText('Aucun fournisseur.')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getAllByRole('button', { name: 'Créer un fournisseur' }).length,
      ).toBeGreaterThan(0),
    );
  });

  it('état erreur : message actionnable avec retry', async () => {
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

    expect(await screen.findByText("Impossible d'afficher les fournisseurs")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
