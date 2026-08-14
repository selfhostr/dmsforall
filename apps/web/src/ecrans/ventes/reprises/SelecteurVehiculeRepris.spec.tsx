import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { VehiculeResume } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecQueryClient } from '@/test/utils';

import { SelecteurVehiculeRepris } from './SelecteurVehiculeRepris';

function rendre(onChangeValeur: (vehiculeId: string, vehicule: VehiculeResume) => void = () => {}) {
  return renduAvecQueryClient(
    <SelecteurVehiculeRepris valeur={null} onChangeValeur={onChangeValeur} />,
  );
}

function reponseListeVide() {
  return HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 });
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

  /**
   * Preuve du défaut #138 corrigé : un véhicule jamais vu par le garage (aucun résultat de
   * recherche) doit pouvoir être créé sans quitter le dialogue de reprise, puis sélectionné
   * automatiquement — exactement comme un résultat de recherche normal.
   */
  describe('création à la volée quand aucun résultat ne correspond (#138)', () => {
    it('crée le véhicule avec les champs minimaux et le sélectionne automatiquement une fois créé', async () => {
      server.use(http.get('/api/v1/vehicules', reponseListeVide));

      let corpsRecu: Record<string, unknown> | null = null;
      let cleIdempotenceRecue: string | null = null;
      server.use(
        http.post('/api/v1/vehicules', async ({ request }) => {
          corpsRecu = (await request.json()) as Record<string, unknown>;
          cleIdempotenceRecue = request.headers.get('Idempotency-Key');
          return HttpResponse.json({
            donnees: {
              id: 'veh-nouveau',
              plaque: null,
              canton: null,
              designation: 'Renault Clio',
              vin: null,
              premiereMiseEnCirculationLe: null,
              identificationIncomplete: true,
              emplacementLibre: null,
            },
            avertissements: [],
          });
        }),
      );

      const onChangeValeur = vi.fn();
      rendre(onChangeValeur);
      const utilisateur = userEvent.setup();
      await utilisateur.type(screen.getByLabelText(/^Véhicule repris\s*\*$/), 'introuvable');

      await screen.findByText('Aucun véhicule ne correspond à cette recherche.');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer ce véhicule' }));

      await utilisateur.type(screen.getByLabelText(/^Marque\s*\*$/), 'Renault');
      await utilisateur.type(screen.getByLabelText(/^Modèle\s*\*$/), 'Clio');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer et sélectionner' }));

      await waitFor(() =>
        expect(onChangeValeur).toHaveBeenCalledWith(
          'veh-nouveau',
          expect.objectContaining({ id: 'veh-nouveau', designation: 'Renault Clio' }),
        ),
      );
      expect(corpsRecu).toMatchObject({ marque: 'Renault', modele: 'Clio', importe: false });
      expect(cleIdempotenceRecue).toBeTruthy();
    });

    it('refuse la soumission sans marque ni modèle, sans appeler le serveur', async () => {
      server.use(http.get('/api/v1/vehicules', reponseListeVide));
      const gestionnairePost = vi.fn(() => HttpResponse.json({ donnees: {}, avertissements: [] }));
      server.use(http.post('/api/v1/vehicules', gestionnairePost));

      rendre();
      const utilisateur = userEvent.setup();
      await utilisateur.type(screen.getByLabelText(/^Véhicule repris\s*\*$/), 'introuvable');
      await screen.findByText('Aucun véhicule ne correspond à cette recherche.');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer ce véhicule' }));

      await utilisateur.click(screen.getByRole('button', { name: 'Créer et sélectionner' }));

      expect(await screen.findAllByText('Ce champ est obligatoire.')).toHaveLength(2);
      expect(gestionnairePost).not.toHaveBeenCalled();
    });

    it('affiche une erreur explicite et actionnable si la création échoue côté serveur', async () => {
      server.use(http.get('/api/v1/vehicules', reponseListeVide));
      server.use(
        http.post(
          '/api/v1/vehicules',
          () => new HttpResponse(null, { status: 500, statusText: 'Erreur serveur' }),
        ),
      );

      rendre();
      const utilisateur = userEvent.setup();
      await utilisateur.type(screen.getByLabelText(/^Véhicule repris\s*\*$/), 'introuvable');
      await screen.findByText('Aucun véhicule ne correspond à cette recherche.');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer ce véhicule' }));

      await utilisateur.type(screen.getByLabelText(/^Marque\s*\*$/), 'Renault');
      await utilisateur.type(screen.getByLabelText(/^Modèle\s*\*$/), 'Clio');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer et sélectionner' }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      // Le mini-formulaire reste ouvert avec la saisie intacte — aucune perte de saisie sur échec.
      expect(screen.getByLabelText(/^Marque\s*\*$/)).toHaveValue('Renault');
    });
  });
});
