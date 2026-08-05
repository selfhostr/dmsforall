import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { PageCurseur, VehiculeResume } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeVehicules } from './EcranListeVehicules';

const VEHICULE_1: VehiculeResume = {
  id: 'v1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
  emplacementLibre: 'Devant, place 3',
};

const VEHICULE_2: VehiculeResume = {
  id: 'v2',
  plaque: '654321',
  canton: 'GE',
  designation: 'Renault Clio',
  vin: null,
  premiereMiseEnCirculationLe: '2021-06-01',
  identificationIncomplete: true,
  // Emplacement jamais renseigné (RPA-03) : cas normal et fréquent, pas d'alarme dans la liste.
  emplacementLibre: null,
};

function pageDe(
  donnees: readonly VehiculeResume[],
  curseurSuivant: string | null = null,
): PageCurseur<VehiculeResume> {
  return { donnees, curseurSuivant, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/vehicules']}>
        <Routes>
          <Route path="/vehicules" element={<EcranListeVehicules />} />
          <Route path="/vehicules/:vehiculeId" element={<div>PAGE_FICHE_VEHICULE</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeVehicules', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche le squelette de chargement avant la résolution de la requête', () => {
    server.use(http.get('/api/v1/vehicules', () => HttpResponse.json(pageDe([]))));
    rendre();
    expect(screen.getByText('Chargement…')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable avec un bouton réessayer', async () => {
    server.use(
      http.get('/api/v1/vehicules', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(await screen.findByText('Impossible de charger les véhicules')).toBeInTheDocument();
    expect(screen.getByText("Une erreur interne s'est produite. Réessayez.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('affiche l’état vide « premier usage » sans filtre ni recherche actifs', async () => {
    server.use(http.get('/api/v1/vehicules', () => HttpResponse.json(pageDe([]))));
    rendre();

    expect(await screen.findByText('Créez votre premier véhicule')).toBeInTheDocument();
    expect(screen.queryByText('Aucun véhicule trouvé')).not.toBeInTheDocument();
  });

  it('rend une ligne par véhicule et navigue vers la fiche au clic', async () => {
    server.use(
      http.get('/api/v1/vehicules', () => HttpResponse.json(pageDe([VEHICULE_1, VEHICULE_2]))),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('WVGZZZ1TZ8W123456')).toBeInTheDocument();
    expect(screen.getByText('Renault Clio')).toBeInTheDocument();
    // Colonne emplacement : affichée quand renseignée (VEHICULE_1), silencieusement absente sinon
    // (VEHICULE_2, `emplacementLibre: null`) — jamais un tiret ni une alarme.
    expect(screen.getByText('Devant, place 3')).toBeInTheDocument();

    await utilisateur.click(screen.getByText('VW Touran 2.0 TDI'));
    expect(await screen.findByText('PAGE_FICHE_VEHICULE')).toBeInTheDocument();
  });

  it('affiche l’état vide « recherche » quand une recherche texte ne remonte aucun résultat', async () => {
    server.use(
      http.get('/api/v1/vehicules', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        return HttpResponse.json(pageDe(q ? [] : [VEHICULE_1]));
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();

    await utilisateur.type(screen.getByRole('searchbox'), 'introuvable');

    expect(
      await screen.findByText('Aucun véhicule trouvé', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it('charge la page suivante au clic sur « Charger plus » (pagination par curseur)', async () => {
    server.use(
      http.get('/api/v1/vehicules', ({ request }) => {
        const curseur = new URL(request.url).searchParams.get('curseur');
        return HttpResponse.json(
          curseur ? pageDe([VEHICULE_2]) : pageDe([VEHICULE_1], 'curseur-page-2'),
        );
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.queryByText('Renault Clio')).not.toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(await screen.findByText('Renault Clio')).toBeInTheDocument();
  });

  it('traduit le titre en allemand', async () => {
    await i18n.changeLanguage('de');
    server.use(http.get('/api/v1/vehicules', () => HttpResponse.json(pageDe([]))));
    rendre();

    expect(await screen.findByText('Erstellen Sie Ihr erstes Fahrzeug')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Fahrzeuge' })).toBeInTheDocument();
  });
});
