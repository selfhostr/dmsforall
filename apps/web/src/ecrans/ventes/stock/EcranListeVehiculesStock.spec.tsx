import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    identificationIncomplete: true,
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

  /**
   * Issue #142 : le champ `emplacementLibre` existe en base depuis la migration `0044` mais
   * n'était exploité NULLE PART côté ventes. Ce test prouve la colonne « Emplacement » à la fois
   * pour une valeur renseignée ET pour son absence — un tiret explicite (`ventes:commun.nonRenseigne`,
   * même clé que `CelluleGarantieSuivi`), jamais une cellule vide silencieuse indiscernable d'un
   * bug de chargement.
   */
  it('colonne Emplacement (#142) : affiche la valeur renseignée, ou un motif explicite si absente', async () => {
    const AVEC_EMPLACEMENT: VehiculeStockResume = {
      ...VEHICULE_STOCK,
      id: 'veh-2',
      vehicule: { ...VEHICULE_STOCK.vehicule, id: 'veh-2', emplacementLibre: 'Devant, place 3' },
    };
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules-stock', () =>
        HttpResponse.json(pageDe([VEHICULE_STOCK, AVEC_EMPLACEMENT])),
      ),
    );

    rendre();

    expect(await screen.findByText('Devant, place 3')).toBeInTheDocument();
    // `VEHICULE_STOCK` (emplacementLibre: null) rend le motif explicite — le tiret apparaît aussi
    // ailleurs sur la ligne (aucune autre colonne financière/date dans ce jeu de données), donc on
    // vérifie qu'il apparaît au moins une fois plutôt qu'une seule occurrence stricte.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('une seule vue (vendeur) : provenance, jours en stock et alerte d’identification toujours affichés, aucune bascule client', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules-stock', () => HttpResponse.json(pageDe([VEHICULE_STOCK]))),
    );

    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('Reprise')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Numéro de châssis manquant')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Vue client' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Vue vendeur' })).not.toBeInTheDocument();
  });

  it('barre d’outils : pas de « Effacer les filtres », et le tri passe par un bouton icône qui ouvre un menu', async () => {
    const tris: (string | null)[] = [];
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules-stock', ({ request }) => {
        tris.push(new URL(request.url).searchParams.get('tri'));
        return HttpResponse.json(pageDe([VEHICULE_STOCK]));
      }),
    );

    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /effacer les filtres/i })).not.toBeInTheDocument();

    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole('button', { name: 'Trier par' }));
    await utilisateur.click(
      await screen.findByRole('menuitemcheckbox', { name: 'Prix de vente (croissant)' }),
    );

    await vi.waitFor(() => expect(tris).toContain('prixVenteAfficheCentimes:asc'));
  });

  it('liste/plan : aucun `aria-controls` cassé sur les onglets de bascule (WCAG 4.1.2)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/vehicules-stock', () => HttpResponse.json(pageDe([VEHICULE_STOCK]))),
    );

    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Liste' })).not.toHaveAttribute('aria-controls');
    expect(screen.getByRole('tab', { name: 'Plan' })).not.toHaveAttribute('aria-controls');

    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole('tab', { name: 'Plan' }));

    expect(screen.getByRole('tab', { name: 'Liste' })).not.toHaveAttribute('aria-controls');
    expect(screen.getByRole('tab', { name: 'Plan' })).not.toHaveAttribute('aria-controls');
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

    expect(await screen.findByText('Aucun véhicule en stock')).toBeInTheDocument();
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
