import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseFactureFournisseur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranFactureFournisseur } from './EcranFactureFournisseur';

const FACTURE_VALIDEE: ReponseFactureFournisseur = {
  id: 'facture-1',
  statut: 'validee',
  document: {
    typeMime: 'application/pdf',
    tailleOctets: 100,
    empreinteSha256: 'abc',
    deposeParId: 'utilisateur-1',
    deposeLe: '2026-08-10T09:00:00.000Z',
  },
  fournisseurId: null,
  commandeFournisseurId: null,
  ibanCreancier: null,
  nomCreancier: 'Bosch',
  numeroFacture: 'F-2026-001',
  dateFacture: '2026-08-09',
  montantTotalCentimes: 10000,
  devise: 'CHF',
  referencePaiement: null,
  champsOrigine: { nomCreancier: 'ocr', numeroFacture: 'qr', montantTotalCentimes: 'qr' },
  lignes: [],
  valideParId: 'utilisateur-1',
  valideLe: '2026-08-10T10:00:00.000Z',
  motifRejet: null,
  creeLe: '2026-08-10T09:00:00.000Z',
  modifieLe: '2026-08-10T10:00:00.000Z',
};

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/factures-fournisseur/facture-1']}>
        <Routes>
          <Route path="/pieces/factures-fournisseur/:id" element={<EcranFactureFournisseur />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranFactureFournisseur', () => {
  it('facture sans correspondance : absence de rapprochement dite clairement, jamais de bouton de décision (déjà validée)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/factures-fournisseur/facture-1', () => HttpResponse.json(FACTURE_VALIDEE)),
    );

    rendre();

    expect(await screen.findByText('Aucun fournisseur reconnu')).toBeInTheDocument();
    expect(screen.getByText('Aucune commande correspondante')).toBeInTheDocument();
    expect(await screen.findByText(/Facture validée le/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Valider la facture fournisseur' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Rejeter' })).not.toBeInTheDocument();
    // Le nom lu par OCR (`nomCreancier`) n'est pas garanti — marqueur « À vérifier » attendu.
    expect(screen.getAllByText('À vérifier').length).toBeGreaterThan(0);
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/factures-fournisseur/facture-1', () =>
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
      await screen.findByText("Impossible d'afficher les factures fournisseur"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
