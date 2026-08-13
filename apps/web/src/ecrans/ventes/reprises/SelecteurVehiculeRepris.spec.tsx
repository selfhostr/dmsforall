import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { SelecteurVehiculeRepris } from './SelecteurVehiculeRepris';

function rendre() {
  return renduAvecQueryClient(<SelecteurVehiculeRepris valeur={null} onChangeValeur={() => {}} />);
}

/**
 * Preuve du défaut 3 corrigé : la requête `GET /vehicules` ne doit partir qu'une fois une
 * recherche non vide saisie — plus d'appel « toute la première page » au montage, alors que l'UI
 * masque le résultat tant que la recherche est vide (`champVehiculeIndication`).
 */
describe('SelecteurVehiculeRepris', () => {
  it('ne déclenche aucun appel réseau au montage, tant que la recherche est vide', async () => {
    const gestionnaire = vi.fn(() =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
    );
    server.use(http.get('/api/v1/vehicules', gestionnaire));

    rendre();

    expect(
      await screen.findByText(
        'Tapez une plaque ou une désignation pour rechercher le véhicule repris.',
      ),
    ).toBeInTheDocument();
    expect(gestionnaire).not.toHaveBeenCalled();
  });

  it('déclenche la requête une fois la recherche saisie (après anti-rebond) et affiche le résultat', async () => {
    const gestionnaire = vi.fn(() =>
      HttpResponse.json({
        donnees: [
          {
            id: 'veh-1',
            plaque: '123456',
            canton: 'VD',
            designation: 'VW Touran 2.0 TDI',
            vin: 'WVWZZZ1KZAP123456',
            premiereMiseEnCirculationLe: '2018-03-01',
            identificationIncomplete: false,
          },
        ],
        curseurSuivant: null,
        limite: 50,
      }),
    );
    server.use(http.get('/api/v1/vehicules', gestionnaire));

    rendre();
    const utilisateur = userEvent.setup();
    await utilisateur.type(screen.getByLabelText(/^Véhicule repris\s*\*$/), '123456');

    await screen.findByText('VW Touran 2.0 TDI');
    expect(gestionnaire).toHaveBeenCalledTimes(1);
  });

  it("l'état vide (pas encore de recherche) ne bascule jamais en erreur ni en chargement permanent", async () => {
    server.use(
      http.get('/api/v1/vehicules', () => {
        throw new Error('ne devrait jamais être appelé recherche vide');
      }),
    );

    rendre();

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
