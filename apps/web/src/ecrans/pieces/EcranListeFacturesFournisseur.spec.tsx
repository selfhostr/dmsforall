import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseFactureFournisseur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeFacturesFournisseur } from './EcranListeFacturesFournisseur';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function facture(patch: Partial<ReponseFactureFournisseur>): ReponseFactureFournisseur {
  return {
    id: 'facture-1',
    statut: 'rapprochee',
    document: {
      typeMime: 'application/pdf',
      tailleOctets: 12345,
      empreinteSha256: 'abc',
      deposeParId: 'utilisateur-1',
      deposeLe: '2026-08-10T09:00:00.000Z',
    },
    fournisseurId: 'fourn-1',
    commandeFournisseurId: 'cmd-1',
    ibanCreancier: null,
    nomCreancier: 'Bosch',
    numeroFacture: 'F-2026-001',
    dateFacture: '2026-08-09',
    montantTotalCentimes: 12050,
    devise: 'CHF',
    referencePaiement: null,
    champsOrigine: { nomCreancier: 'qr', numeroFacture: 'qr', montantTotalCentimes: 'qr' },
    lignes: [],
    valideParId: null,
    valideLe: null,
    motifRejet: null,
    creeLe: '2026-08-10T09:00:00.000Z',
    modifieLe: '2026-08-10T09:00:00.000Z',
    ...patch,
  };
}

function pageDe(
  donnees: readonly ReponseFactureFournisseur[],
): PageCurseur<ReponseFactureFournisseur> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/factures-fournisseur']}>
        <Routes>
          <Route path="/pieces/factures-fournisseur" element={<EcranListeFacturesFournisseur />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeFacturesFournisseur', () => {
  it('affiche les factures avec fournisseur, montant et écarts signalés', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/factures-fournisseur', () =>
        HttpResponse.json(
          pageDe([
            facture({
              lignes: [
                {
                  id: 'ligne-1',
                  numeroOrdre: 1,
                  referenceArticle: 'REF-1',
                  designation: 'Plaquette',
                  quantiteMillieme: 2000,
                  prixUnitaireCentimes: 5000,
                  totalLigneCentimes: 10000,
                  origine: 'qr',
                  articleId: 'article-1',
                  commandeFournisseurLigneId: 'cmd-ligne-1',
                  ecart: { prixUnitaireCentimes: 100, quantiteMillieme: 0, totalCentimes: 200 },
                },
              ],
            }),
          ]),
        ),
      ),
    );

    rendre();

    expect(await screen.findByText('F-2026-001')).toBeInTheDocument();
    expect(screen.getByText('Bosch')).toBeInTheDocument();
    // 12050 centimes -> 120.50 francs, jamais un montant tronqué.
    expect(screen.getByText('120.50')).toBeInTheDocument();
    expect(screen.getByText('Écarts à vérifier')).toBeInTheDocument();
  });

  it('valeur non lue : jamais affichée comme un montant à zéro', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/factures-fournisseur', () =>
        HttpResponse.json(
          pageDe([
            facture({
              id: 'facture-2',
              montantTotalCentimes: null,
              champsOrigine: { montantTotalCentimes: 'ocr' },
            }),
          ]),
        ),
      ),
    );

    rendre();

    await screen.findByText('F-2026-001');
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.getByText('Non lu')).toBeInTheDocument();
  });

  it('état vide : aucune facture déposée', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/factures-fournisseur', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(await screen.findByText('Aucune facture fournisseur déposée')).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/factures-fournisseur', () =>
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

    await waitFor(() => {
      expect(
        screen.getByText("Impossible d'afficher les factures fournisseur"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('rôle sans droit de lecture (RF-115, admin) : message dédié, aucun appel réseau à la liste', async () => {
    let appele = false;
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'admin' },
        }),
      ),
      http.get('/api/v1/factures-fournisseur', () => {
        appele = true;
        return HttpResponse.json(pageDe([]));
      }),
    );

    rendre();

    expect(
      await screen.findByText("Vous n'avez pas le droit de consulter les factures fournisseur."),
    ).toBeInTheDocument();
    expect(appele).toBe(false);
  });
});
