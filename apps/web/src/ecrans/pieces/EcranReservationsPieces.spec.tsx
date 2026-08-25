import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseReservationPiece } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranReservationsPieces } from './EcranReservationsPieces';

// Radix Select appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même stub que
// `EcranListeFournisseurs.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const RESERVATION: ReponseReservationPiece = {
  id: 'reservation-1',
  articleId: 'article-1',
  articleNumero: 'P-000123',
  articleDesignation: 'Plaquettes de frein avant',
  siteId: 'site-1',
  ligneOrId: 'ligne-or-1',
  ordreReparationId: 'or-1',
  ordreReparationNumero: 'OR-2026-0042',
  quantiteMillieme: 1000,
  statut: 'active',
  creeLe: '2026-08-01T08:00:00.000Z',
  satisfaiteLe: null,
  mouvementSortieId: null,
  libereeLe: null,
  motifLiberation: null,
  motifLiberationTexte: null,
  libereeParUtilisateurId: null,
};

function pageDe(donnees: readonly ReponseReservationPiece[]): PageCurseur<ReponseReservationPiece> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/reservations']}>
        <Routes>
          <Route path="/pieces/reservations" element={<EcranReservationsPieces />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranReservationsPieces', () => {
  it('affiche les réservations actives par défaut, avec article et OR lisibles', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/reservations', () => HttpResponse.json(pageDe([RESERVATION]))),
    );

    rendre();

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();
    expect(screen.getByText('OR-2026-0042')).toBeInTheDocument();
  });

  it('état vide : filtre `statut` actif par défaut', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/reservations', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(await screen.findByText('Aucune réservation avec ce statut')).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/reservations', () =>
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

    expect(await screen.findByText("Impossible d'afficher les réservations")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  // Preuve que la recherche atteint le SERVEUR (`q`), plus jamais un filtrage sur les lignes déjà
  // chargées (même patron que `EcranListeFournisseurs.spec.tsx`) : le mock ne renvoie une
  // réservation QUE si `q` est absent de la requête.
  it('la recherche envoie `q` au serveur — un terme inexistant rend la liste vide, pas un filtrage local', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/reservations', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        return HttpResponse.json(pageDe(q ? [] : [RESERVATION]));
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();

    await utilisateur.type(screen.getByRole('searchbox'), 'introuvable');

    expect(
      await screen.findByText('Aucune réservation trouvée', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Plaquettes de frein avant')).not.toBeInTheDocument(),
    );
  });
});
