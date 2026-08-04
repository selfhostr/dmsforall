import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseDossierVente } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFicheDossierVente } from './EcranFicheDossierVente';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CLIENT_ACHETEUR = {
  id: 'client-1',
  numeroClient: 'CL-0001',
  nomAffiche: 'Jean Dupont',
  type: 'particulier' as const,
  statut: 'actif' as const,
  langueCorrespondance: 'fr' as const,
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 0,
  dernierPassageLe: null,
};

const DOSSIER: ReponseDossierVente = {
  id: 'dossier-1',
  siteId: 'site-1',
  statut: 'prospection',
  typeVehicule: null,
  vehicule: null,
  clientAcheteur: CLIENT_ACHETEUR,
  clientFacture: CLIENT_ACHETEUR,
  clientConducteur: null,
  reprise: null,
  financement: null,
  financements: [],
  financementsTronques: false,
  documents: [],
  documentsTronques: false,
  documentsRequis: [],
  identitePieceType: null,
  identiteVerifieeLe: null,
  dateLivraisonEstimee: null,
  dateLivraisonEffective: null,
  kilometrageDepart: null,
  prospectionLe: '2026-08-01T08:00:00.000Z',
  engageLe: null,
  enPreparationLe: null,
  pretALivrerLe: null,
  livreLe: null,
  closLe: null,
  annuleLe: null,
  abandonneLe: null,
  motifCloture: null,
  actionsDisponibles: ['modifier', 'engager', 'annuler', 'abandonner'],
  version: 1,
  creeLe: '2026-08-01T08:00:00.000Z',
  modifieLe: '2026-08-01T08:00:00.000Z',
  modifiePar: null,
};

function rendre(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'vendeur') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/dossiers/dossier-1']}>
        <Routes>
          <Route path="/ventes/dossiers/:id" element={<EcranFicheDossierVente />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFicheDossierVente', () => {
  it('affiche la fiche avec le client, le statut et les actions de transition', async () => {
    server.use(http.get('/api/v1/dossiers-vente/dossier-1', () => HttpResponse.json(DOSSIER)));

    rendre();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getAllByText('Prospection').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Engager' })).toBeInTheDocument();
    expect(screen.getByText('Pas de reprise sur ce dossier')).toBeInTheDocument();
    expect(screen.getByText('Aucun financement en cours.')).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/dossier-1', () =>
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

    expect(await screen.findByText("Impossible d'afficher ce dossier")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
