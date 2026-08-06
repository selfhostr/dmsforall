import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseDepotPneus } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranJeuxARelancer } from './EcranJeuxARelancer';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const DEPOT_A_RELANCER: ReponseDepotPneus = {
  id: 'depot-2',
  vehiculeId: 'vehicule-2',
  siteId: 'site-1',
  saison: 'ete',
  statut: 'a_relancer',
  codeCase: 'Rack 7',
  dimension: '195/65 R15',
  etat: null,
  entreLe: '2023-01-01T08:00:00.000Z',
  dernierMouvementLe: '2023-01-01T08:00:00.000Z',
  motifSortie: null,
  ligneOrDernierChangementId: null,
  creeLe: '2023-01-01T08:00:00.000Z',
  modifieLe: '2023-01-01T08:00:00.000Z',
};

function pageDe(donnees: readonly ReponseDepotPneus[]): PageCurseur<ReponseDepotPneus> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pneus/a-relancer']}>
        <Routes>
          <Route path="/pneus/a-relancer" element={<EcranJeuxARelancer />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranJeuxARelancer', () => {
  it('affiche les jeux oubliés depuis plus de deux ans', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/depots-pneus/a-relancer', () =>
        HttpResponse.json(pageDe([DEPOT_A_RELANCER])),
      ),
    );

    rendre();

    expect(await screen.findByText('Rack 7')).toBeInTheDocument();
  });

  it('état vide : aucun jeu à relancer', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/depots-pneus/a-relancer', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(await screen.findByText('Aucun jeu à relancer.')).toBeInTheDocument();
  });

  it(
    'ne propose pas « Changer de saison » — défaut corrigé : cette liste ne contient QUE des ' +
      'dépôts au statut `a_relancer`, un statut où le serveur rejette systématiquement ce geste ' +
      '(autorisé seulement `en_depot`/`monte`, même condition que `CarteJeuPneu`) — « Sortir » ' +
      'reste bien proposé, lui, à un rôle habilité (`chef_atelier`, session de test par défaut)',
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/depots-pneus/a-relancer', () =>
          HttpResponse.json(pageDe([DEPOT_A_RELANCER])),
        ),
      );

      rendre();

      expect(await screen.findByRole('button', { name: 'Sortir' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Changer de saison' })).not.toBeInTheDocument();
    },
  );
});
