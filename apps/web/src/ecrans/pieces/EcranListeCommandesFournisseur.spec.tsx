import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseCommandeFournisseur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeCommandesFournisseur } from './EcranListeCommandesFournisseur';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const COMMANDE: ReponseCommandeFournisseur = {
  id: 'cmd-1',
  fournisseurId: 'fourn-1',
  siteId: 'site-1',
  statut: 'envoyee',
  origine: 'manuelle',
  dateCommande: '2026-02-01',
  envoyeeLe: '2026-02-01T09:00:00.000Z',
  reference: 'BOSCH-4521',
  motifAnnulation: null,
  lignes: [],
  lignesTronquees: false,
  creeLe: '2026-02-01T08:00:00.000Z',
  modifieLe: '2026-02-01T09:00:00.000Z',
};

function pageDe(donnees: readonly ReponseCommandeFournisseur[]): PageCurseur<ReponseCommandeFournisseur> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/commandes-fournisseur']}>
        <Routes>
          <Route path="/pieces/commandes-fournisseur" element={<EcranListeCommandesFournisseur />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeCommandesFournisseur', () => {
  it('affiche les commandes avec leur statut et leur référence', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', () => HttpResponse.json(pageDe([COMMANDE]))),
    );

    rendre();

    expect(await screen.findByText('BOSCH-4521')).toBeInTheDocument();
    expect(screen.getByText('Envoyée')).toBeInTheDocument();
  });

  it('état vide : invite à créer la première commande', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(await screen.findByText('Aucune commande.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Créer une commande' }).length).toBeGreaterThan(0);
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', () =>
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

    expect(await screen.findByText("Impossible d'afficher les commandes")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
