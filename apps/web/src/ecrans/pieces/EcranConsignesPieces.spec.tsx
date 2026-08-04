import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseConsigneEchangeStandard } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranConsignesPieces } from './EcranConsignesPieces';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CONSIGNE: ReponseConsigneEchangeStandard = {
  id: 'consigne-1',
  ligneOrId: 'ligne-or-1',
  ordreReparationId: 'or-1',
  articleId: 'article-1',
  siteId: 'site-1',
  statut: 'en_attente_retour_fournisseur',
  montantConsigneTtcCentimes: 15000,
  documentVenteLigneConsigneId: null,
  mouvementEntreeId: 'mvt-1',
  retourneeFournisseurLe: null,
  mouvementRetourId: null,
  avoirDocumentId: null,
  creeLe: '2026-01-10T08:00:00.000Z',
};

function pageDe(
  donnees: readonly ReponseConsigneEchangeStandard[],
): PageCurseur<ReponseConsigneEchangeStandard> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'magasinier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/consignes']}>
        <Routes>
          <Route path="/pieces/consignes" element={<EcranConsignesPieces />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranConsignesPieces', () => {
  it('affiche les consignes en attente de retour, avec le montant', async () => {
    server.use(http.get('/api/v1/consignes', () => HttpResponse.json(pageDe([CONSIGNE]))));

    rendre();

    expect(await screen.findByText('150.00')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).getByText('En attente de retour')).toBeInTheDocument();
  });

  it('un magasinier peut marquer une consigne comme retournée, après confirmation', async () => {
    server.use(http.get('/api/v1/consignes', () => HttpResponse.json(pageDe([CONSIGNE]))));
    let appelRetour = false;
    server.use(
      http.post('/api/v1/consignes/:id/marquer-retour-fournisseur', () => {
        appelRetour = true;
        return HttpResponse.json({
          ...CONSIGNE,
          statut: 'retournee_fournisseur',
          retourneeFournisseurLe: '2026-02-01T10:00:00.000Z',
        });
      }),
    );

    rendre('magasinier');
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Marquer comme retournée' }));
    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(
      within(dialogue).getByRole('button', { name: 'Marquer comme retournée' }),
    );

    await waitFor(() => expect(appelRetour).toBe(true));
  });

  it('un rôle non habilité ne voit pas l’action de retour', async () => {
    server.use(http.get('/api/v1/consignes', () => HttpResponse.json(pageDe([CONSIGNE]))));

    rendre('vendeur');

    expect(await screen.findByText('150.00')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Marquer comme retournée' }),
    ).not.toBeInTheDocument();
  });

  it('état vide : aucune consigne', async () => {
    server.use(http.get('/api/v1/consignes', () => HttpResponse.json(pageDe([]))));

    rendre();

    expect(await screen.findByText('Aucune consigne.')).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/consignes', () =>
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

    expect(await screen.findByText("Impossible d'afficher les consignes")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
