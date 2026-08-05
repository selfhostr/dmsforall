import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, VehiculeStockResume } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { enregistrerTraductionsTestVentes } from './_composants/traductions-test';
import { EcranListeVehiculesStock } from './EcranListeVehiculesStock';

beforeAll(() => {
  enregistrerTraductionsTestVentes();
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const VEHICULE_STOCK: VehiculeStockResume = {
  id: 'veh-1',
  vehicule: {
    id: 'veh-1',
    plaque: 'VD 123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    vin: 'WVWZZZ1KZAW123456',
    premiereMiseEnCirculationLe: '2018-04-01',
    identificationIncomplete: false,
    emplacementLibre: null,
  },
  provenance: 'reprise',
  typeVehicule: 'vo',
  statutCommercial: 'disponible',
  prixVenteAfficheCentimes: 189_000,
  joursStock: 12,
};

function pageDe(donnees: readonly VehiculeStockResume[]): PageCurseur<VehiculeStockResume> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/stock']}>
        <Routes>
          <Route path="/ventes/stock" element={<EcranListeVehiculesStock />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeVehiculesStock', () => {
  it('affiche les véhicules en stock avec leur statut et leur prix', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules-stock', () => HttpResponse.json(pageDe([VEHICULE_STOCK]))),
    );

    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
    expect(screen.getByText("1'890.00")).toBeInTheDocument();
  });

  it('état vide : invite à mettre un véhicule en stock', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' },
        }),
      ),
      http.get('/api/v1/vehicules-stock', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(
      await screen.findByText('Aucun véhicule en stock ne correspond à ces critères.'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Mettre un véhicule en stock' }).length,
    ).toBeGreaterThan(0);
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules-stock', () =>
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
      await screen.findByText("Impossible d'afficher les véhicules en stock"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
