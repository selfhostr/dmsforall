import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranTableauBord } from './EcranTableauBord';

vi.mock('@/ecrans/accueil/composants/ChecklistDemarrage', () => ({
  ChecklistDemarrage: () => null,
}));

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const PAGE_VIDE = { donnees: [], curseurSuivant: null, limite: 50 };
const PERIODE = { du: '2026-08-01', au: '2026-08-31' };

function stubsAccueil(role: (typeof SESSION_TEST)['utilisateur']['role']) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
    http.get('/api/v1/tableau-bord/activite', () =>
      HttpResponse.json({
        periode: PERIODE,
        siteId: null,
        ordresReparationParStatut: [],
        ordresReparationOuvertsPeriode: 0,
        ordresReparationRestituesPeriode: 0,
        delaiMoyenRestitutionMinutes: null,
        lignesEnAttenteValidation: 0,
        articlesSousSeuilReapprovisionnement: 0,
      }),
    ),
    http.get('/api/v1/tableau-bord/financier', () =>
      HttpResponse.json({
        periode: PERIODE,
        siteId: null,
        chiffreAffaires: {
          totalHtCentimes: 0,
          totalTvaCentimes: 0,
          totalTtcCentimes: 0,
          nombreDocuments: 0,
        },
        encaissementsCentimes: 0,
        encoursClientsCentimes: 0,
        marges: {
          vehicules: { margeCentimes: 0, nombreVehiculesFactures: 0 },
          pieces: { disponible: false, raisonCle: 'piecesCoutNonFiable' },
          mainOeuvre: { disponible: false, raisonCle: 'mainOeuvreCoutAbsent' },
        },
        stockPieces: { totalCentimes: 0, articlesValeurInconnueNombre: 0 },
      }),
    ),
    http.get('/api/v1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/documents-vente', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/rendez-vous', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/recherche', () =>
      HttpResponse.json({ resultats: [], plaqueInterchangeable: false }),
    ),
  );
}

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <FournisseurSiteCourant>
        <MemoryRouter initialEntries={['/tableau-bord']}>
          <Routes>
            <Route path="/tableau-bord" element={<EcranTableauBord />} />
          </Routes>
        </MemoryRouter>
      </FournisseurSiteCourant>
    </QueryClientProvider>,
  );
}

describe('Accueil orienté tâche', () => {
  it('direction : recherche en haut, les quatre actions rapides, « à faire » avant les chiffres', async () => {
    stubsAccueil('direction');
    rendre();

    const recherche = await screen.findByPlaceholderText("Plaque, client ou n° d'OR");
    expect(recherche).toBeInTheDocument();

    const actions = screen.getByRole('navigation', { name: 'Actions rapides' });
    const creer = within(actions).getByRole('link', { name: 'Créer un OR' });
    expect(creer).toHaveAttribute('href', '/atelier/ordres-reparation/depuis-plaque?site=site-1');
    expect(within(actions).getByRole('link', { name: 'Nouveau rendez-vous' })).toBeInTheDocument();
    expect(within(actions).getByRole('button', { name: 'Nouveau devis' })).toBeInTheDocument();
    expect(within(actions).getByRole('link', { name: 'Encaisser' })).toBeInTheDocument();

    const aFaire = await screen.findByRole('region', { name: "À faire aujourd'hui" });
    expect(within(aFaire).getByText('Terminés, à facturer')).toBeInTheDocument();
    expect(within(aFaire).getByText('Factures échues')).toBeInTheDocument();
    expect(within(aFaire).getByText("En attente de l'accord du client")).toBeInTheDocument();

    // L'ordre du DOM : recherche, puis à faire, puis chiffres.
    const chiffres = screen.getByRole('heading', { name: 'Chiffres' });
    expect(
      recherche.compareDocumentPosition(aFaire) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      aFaire.compareDocumentPosition(chiffres) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("chef d'atelier : peut créer un OR mais ni encaisser ni voir les factures échues", async () => {
    stubsAccueil('chef_atelier');
    rendre();

    const actions = await screen.findByRole('navigation', { name: 'Actions rapides' });
    expect(within(actions).getByRole('link', { name: 'Créer un OR' })).toBeInTheDocument();
    expect(within(actions).queryByRole('link', { name: 'Encaisser' })).not.toBeInTheDocument();

    const aFaire = await screen.findByRole('region', { name: "À faire aujourd'hui" });
    expect(within(aFaire).queryByText('Factures échues')).not.toBeInTheDocument();
    expect(within(aFaire).queryByText('Terminés, à facturer')).not.toBeInTheDocument();
    expect(within(aFaire).getByText("En attente de l'accord du client")).toBeInTheDocument();
  });

  it('comptable : recherche et encaisser, pas de création d’OR, pas de « à faire » atelier', async () => {
    stubsAccueil('comptable');
    rendre();

    expect(await screen.findByPlaceholderText("Plaque, client ou n° d'OR")).toBeInTheDocument();
    const actions = screen.getByRole('navigation', { name: 'Actions rapides' });
    expect(within(actions).getByRole('link', { name: 'Encaisser' })).toBeInTheDocument();
    expect(within(actions).queryByRole('link', { name: 'Créer un OR' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: "À faire aujourd'hui" })).not.toBeInTheDocument();
  });

  it('chaque bloc « à faire » a son état vide explicite (message, pas une carte muette)', async () => {
    stubsAccueil('direction');
    rendre();

    expect(await screen.findByText('Rien à facturer')).toBeInTheDocument();
    expect(await screen.findByText('Aucune facture échue')).toBeInTheDocument();
    expect(await screen.findByText('Aucune réponse à attendre')).toBeInTheDocument();
  });
});
