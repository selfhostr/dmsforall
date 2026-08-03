import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseCommandeFournisseur, ReponseFournisseur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFicheCommandeFournisseur } from './EcranFicheCommandeFournisseur';

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
  lignes: [
    {
      id: 'ligne-1',
      commandeFournisseurId: 'cmd-1',
      numeroOrdre: 1,
      articleId: 'article-1',
      quantiteCommandeeMillieme: 5000,
      quantiteRecueCumuleeMillieme: 0,
      quantiteReliquatMillieme: 5000,
      reliquatAnnuleLe: null,
      reliquatMotifAnnulation: null,
      prixAchatAttenduCentimes: 2000,
      ligneOrOrigineId: null,
    },
  ],
  lignesTronquees: false,
  creeLe: '2026-02-01T08:00:00.000Z',
  modifieLe: '2026-02-01T09:00:00.000Z',
};

const FOURNISSEUR: ReponseFournisseur = {
  id: 'fourn-1',
  nom: 'Bosch Service SA',
  email: null,
  telephone: null,
  delaiHabituelJours: null,
  statut: 'actif',
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-01T08:00:00.000Z',
};

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'magasinier') {
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } })),
    http.get('/api/v1/commandes-fournisseur/cmd-1', () => HttpResponse.json(COMMANDE)),
    http.get('/api/v1/fournisseurs/fourn-1', () => HttpResponse.json(FOURNISSEUR)),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/commandes-fournisseur/cmd-1']}>
        <Routes>
          <Route path="/pieces/commandes-fournisseur/:id" element={<EcranFicheCommandeFournisseur />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFicheCommandeFournisseur', () => {
  it('affiche la fiche avec le fournisseur, le statut et les lignes', async () => {
    rendre();

    expect(await screen.findByText('Bosch Service SA')).toBeInTheDocument();
    expect(screen.getByText('Envoyée')).toBeInTheDocument();
    expect(screen.getByText('20.00')).toBeInTheDocument(); // montant attendu : 5 x 4.00
  });

  it('un magasinier peut réceptionner une ligne, avec quantité et prix réel', async () => {
    let corpsRecu: unknown;
    server.use(
      http.post('/api/v1/commandes-fournisseur/cmd-1/reception', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(
          {
            donnees: {
              mouvementsCrees: ['mvt-1'],
              commandeFournisseur: { ...COMMANDE, statut: 'recue', lignes: [{ ...COMMANDE.lignes[0], quantiteRecueCumuleeMillieme: 5000, quantiteReliquatMillieme: 0 }] },
            },
            avertissements: [],
          },
          { status: 201 },
        );
      }),
    );

    rendre('magasinier');
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier' }));
    await utilisateur.click(await screen.findByRole('menuitem', { name: 'Enregistrer une réception' }));

    const dialogue = await screen.findByRole('dialog');
    await utilisateur.click(within(dialogue).getByRole('checkbox'));
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Enregistrer une réception' }));

    await waitFor(() => expect(corpsRecu).toEqual({ lignes: [{ ligneId: 'ligne-1', quantiteRecueMillieme: 5000, prixAchatReelCentimes: 2000, motif: undefined }] }));
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur/cmd-1', () =>
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

    const queryClient = creerQueryClientTest();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/pieces/commandes-fournisseur/cmd-1']}>
          <Routes>
            <Route path="/pieces/commandes-fournisseur/:id" element={<EcranFicheCommandeFournisseur />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("Impossible d'afficher cette commande")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
