import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { PageCurseur, VehiculeResume } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { SelecteurVehiculeOrdre } from './SelecteurVehiculeOrdre';

const VEHICULE_1: VehiculeResume = {
  id: 'v1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
};

const VEHICULE_2: VehiculeResume = {
  id: 'v2',
  plaque: '654321',
  canton: 'GE',
  designation: 'Renault Clio',
  vin: null,
  premiereMiseEnCirculationLe: '2015-06-01',
  identificationIncomplete: true,
};

function rendre(clientId = 'cl-1', onChangeValeur = vi.fn()) {
  return { onChangeValeur, ...renduAvecQueryClient(<SelecteurVehiculeOrdre clientId={clientId} valeur={null} onChangeValeur={onChangeValeur} />) };
}

describe('SelecteurVehiculeOrdre', () => {
  it('affiche un squelette de chargement puis la liste des véhicules détenus par le client', async () => {
    server.use(
      http.get('/api/v1/clients/cl-1/vehicules', () =>
        HttpResponse.json({ donnees: [VEHICULE_1, VEHICULE_2], curseurSuivant: null, limite: 50 } satisfies PageCurseur<VehiculeResume>),
      ),
    );
    rendre();

    expect(await screen.findByRole('radio', { name: /VW Touran 2\.0 TDI/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Renault Clio/ })).toBeInTheDocument();
  });

  it("affiche un état vide explicite quand le client ne détient aucun véhicule, plutôt qu'une liste vide silencieuse", async () => {
    server.use(
      http.get('/api/v1/clients/cl-1/vehicules', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 } satisfies PageCurseur<VehiculeResume>),
      ),
    );
    rendre();

    expect(await screen.findByText("Ce client n'a aucun véhicule enregistré à son nom.")).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it("affiche une erreur actionnable avec réessayer si le chargement échoue", async () => {
    server.use(
      http.get('/api/v1/clients/cl-1/vehicules', () =>
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

    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('sélectionner un véhicule transmet SON identifiant ET son objet complet — jamais reconstruit localement', async () => {
    server.use(
      http.get('/api/v1/clients/cl-1/vehicules', () =>
        HttpResponse.json({ donnees: [VEHICULE_1, VEHICULE_2], curseurSuivant: null, limite: 50 } satisfies PageCurseur<VehiculeResume>),
      ),
    );
    const utilisateur = userEvent.setup();
    const { onChangeValeur } = rendre();

    await utilisateur.click(await screen.findByRole('radio', { name: /Renault Clio/ }));

    expect(onChangeValeur).toHaveBeenCalledWith('v2', VEHICULE_2);
  });
});
