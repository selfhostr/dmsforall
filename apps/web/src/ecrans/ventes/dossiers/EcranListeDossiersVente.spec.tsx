import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseDossierVente } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeDossiersVente } from './EcranListeDossiersVente';

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
  garantie: null,
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

function rendre() {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/dossiers']}>
        <Routes>
          <Route path="/ventes/dossiers" element={<EcranListeDossiersVente />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeDossiersVente', () => {
  it('affiche la liste avec le client et le statut du dossier', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente', () =>
        HttpResponse.json({ donnees: [DOSSIER], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText('Prospection')).toBeInTheDocument();
    expect(screen.getByText('— non assigné')).toBeInTheDocument();
  });

  it('état vide : aucun dossier de vente', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(await screen.findByText('Aucun dossier de vente.')).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente', () =>
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

    expect(
      await screen.findByText("Impossible d'afficher les dossiers de vente"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
