import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { construireDocumentBrut } from './document.fixture';
import { EcranFicheFacture } from './EcranFicheFacture';

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter initialEntries={['/factures/devis-1']}>
        <Routes>
          <Route path="/factures/:id" element={<EcranFicheFacture />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function installerDevis(overrides: Parameters<typeof construireDocumentBrut>[0] = {}) {
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
    http.get('/api/v1/documents-vente/devis-1', () =>
      HttpResponse.json(
        construireDocumentBrut({
          id: 'devis-1',
          typeDocument: 'devis',
          natureFacture: null,
          numero: null,
          statut: 'brouillon',
          statutReglement: undefined,
          soldeCentimes: undefined,
          qr: null,
          emisLe: null,
          emisPar: null,
          ...overrides,
        }),
      ),
    ),
  );
}

describe('EcranFicheFacture — devis', () => {
  it('titre un devis en brouillon « Nouveau devis », jamais « Nouvelle facture »', async () => {
    installerDevis();
    rendre();

    expect(await screen.findByRole('heading', { name: 'Nouveau devis' })).toBeInTheDocument();
    expect(screen.queryByText('Nouvelle facture')).not.toBeInTheDocument();
  });

  it('propose « Télécharger le PDF » pour un devis, et affiche l’erreur DOCUMENT_PDF_INDISPONIBLE tant que l’API ne le produit pas', async () => {
    installerDevis({ numero: '2026-D-00001', statut: 'emis' });
    server.use(
      http.get('/api/v1/documents-vente/devis-1/pdf', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DOCUMENT_PDF_INDISPONIBLE',
            title: 'Document PDF pas encore disponible',
            status: 409,
            code: 'DOCUMENT_PDF_INDISPONIBLE',
            instance: '',
          },
          { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(await screen.findByRole('button', { name: 'Télécharger le PDF' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Le PDF n'est pas encore prêt. Patientez quelques instants.",
    );
  });
});
