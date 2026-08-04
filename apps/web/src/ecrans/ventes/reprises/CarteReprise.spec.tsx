import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseReprise } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { CarteReprise } from './CarteReprise';

const REPRISE: ReponseReprise = {
  id: 'reprise-1',
  dossierVenteId: 'dossier-1',
  vehiculeRepris: {
    id: 'vehicule-1',
    plaque: '123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    vin: 'WVWZZZ1KZAP123456',
    premiereMiseEnCirculationLe: '2018-03-01',
    identificationIncomplete: false,
  },
  statut: 'negociee',
  valeurEstimeeCentimes: 800_000,
  valeurNegocieeCentimes: 850_000,
  ecartRepriseVehiculeCentimes: 50_000,
  detteFinancementResiduelleCentimes: null,
  detteFinancementOrganismeId: null,
  detteFinancementOrganismeNom: null,
  estimeeLe: '2026-01-01T08:00:00.000Z',
  negocieeLe: '2026-01-02T08:00:00.000Z',
  confirmeeLe: null,
  refuseeLe: null,
  motifRefus: null,
  actionsDisponibles: ['negocier', 'refuser'],
  version: 1,
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-02T08:00:00.000Z',
  modifiePar: null,
};

function rendre(ui: ReactElement) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CarteReprise', () => {
  it('affiche un état vide avec une action « Ajouter une reprise » quand le dossier n’en a pas', () => {
    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise={false} role="vendeur" />);

    expect(screen.getByText('Pas de reprise sur ce dossier')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter une reprise' })).toBeInTheDocument();
  });

  it('n’affiche pas l’action d’ajout pour un rôle sans droit d’écriture', () => {
    rendre(
      <CarteReprise dossierVenteId="dossier-1" possedeReprise={false} role="receptionnaire" />,
    );

    expect(screen.getByText('Pas de reprise sur ce dossier')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une reprise' })).not.toBeInTheDocument();
  });

  it('affiche les deux valeurs, l’écart et le statut quand la reprise existe', async () => {
    server.use(http.get('/api/v1/dossiers-vente/:id/reprise', () => HttpResponse.json(REPRISE)));

    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise role="vendeur" />);

    await waitFor(() => {
      expect(screen.getByText("8'500.00")).toBeInTheDocument();
    });
    expect(screen.getByText("8'000.00")).toBeInTheDocument();
    expect(screen.getByText('+500.00')).toBeInTheDocument();
    expect(screen.getByText('Négociée')).toBeInTheDocument();
    expect(screen.getByText('VW Touran 2.0 TDI')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable (retry) si la reprise ne peut pas être chargée', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/:id/reprise', () =>
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

    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise role="vendeur" />);

    await waitFor(() => {
      expect(screen.getByText("Impossible d'afficher cette reprise")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
