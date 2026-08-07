import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import type { OrdreReparationResume, ReponseClient, VehiculeResume } from '@dfa/shared';

import i18n from '@/i18n';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranFicheClient } from './EcranFicheClient';

const CLIENT_TEST: ReponseClient = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  type: 'particulier',
  statut: 'actif',
  civilite: null,
  nom: 'Dupont',
  prenom: 'Jean',
  raisonSociale: null,
  nomAffiche: 'Jean Dupont',
  ide: null,
  langueCorrespondance: 'fr',
  email: 'jean.dupont@example.ch',
  telephone: '+41791234567',
  telephoneE164: '+41791234567',
  poObligatoire: false,
  groupeId: null,
  fusionneVersClientId: null,
  referenceExterne: null,
  dernierPassageLe: null,
  creeLe: '2026-01-01T00:00:00.000Z',
  modifieLe: '2026-01-01T00:00:00.000Z',
  notesAlerte: [],
  plusAucunContact: false,
  motif: null,
};

const PAGE_VIDE = { donnees: [], curseurSuivant: null, limite: 50 };

const VEHICULE_TEST: VehiculeResume = {
  id: 'veh-1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: null,
  premiereMiseEnCirculationLe: null,
  identificationIncomplete: false,
  emplacementLibre: null,
};

const OR_TEST: OrdreReparationResume = {
  id: 'or-1',
  numero: 'OR-000123',
  statut: 'ouvert',
  etatAffiche: 'ouvert',
  type: 'reparation',
  localisation: 'atelier',
  ouvertLe: '2026-07-01T08:00:00.000Z',
  restitutionPromiseLe: null,
  vehicule: VEHICULE_TEST,
  client: {
    id: 'cl-1',
    numeroClient: 'CL-000123',
    nomAffiche: 'Jean Dupont',
    type: 'particulier',
    statut: 'actif',
    langueCorrespondance: 'fr',
    poObligatoire: false,
    telephone: null,
    localite: null,
    nombreVehicules: 1,
    dernierPassageLe: null,
  },
  nombreLignes: 2,
};

/** Chaque test choisit son URL initiale (avec ou sans `?site=`) et les routes de destination
 *  utilisées pour vérifier CE que la navigation a réellement conservé (routes/chemins.ts : le
 *  site est un paramètre de requête, jamais un état global — voir aussi EcranListeVehicules). */
function rendreEcran(routeInitiale = '/clients/cl-1') {
  return renduAvecRoutes(
    [
      { path: '/clients/:id', element: <EcranFicheClient /> },
      { path: '/vehicules/:vehiculeId', element: <div>PAGE_VEHICULE</div> },
      { path: '/ordres-reparation/:id', element: <div>PAGE_OR</div> },
      { path: '/atelier/ordres-reparation/nouveau', element: <div>PAGE_NOUVEL_OR</div> },
    ],
    { routeInitiale },
  );
}

function repondreFicheOk(client: typeof CLIENT_TEST = CLIENT_TEST) {
  server.use(
    http.get('/api/v1/clients/cl-1', () => HttpResponse.json(client)),
    http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
  );
}

describe('EcranFicheClient', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it("affiche l'identité, les onglets et les états vides une fois la fiche chargée", async () => {
    repondreFicheOk();
    rendreEcran();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Contacts' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Adresses' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Consentements' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Notes' })).toBeInTheDocument();
    expect(await screen.findByText('Aucun contact enregistré.')).toBeInTheDocument();
    expect(screen.getByText('Aucun véhicule rattaché.')).toBeInTheDocument();
    expect(screen.getByText('Aucun passage enregistré.')).toBeInTheDocument();
  });

  it('affiche le bandeau bloqué pour un client au statut bloqué', async () => {
    repondreFicheOk({ ...CLIENT_TEST, statut: 'bloque' });
    rendreEcran();

    expect(await screen.findByRole('alert')).toHaveTextContent('Bloqué – impayés');
  });

  it('affiche des lignes squelette pendant le chargement de la fiche', async () => {
    server.use(
      http.get('/api/v1/clients/cl-1', async () => {
        await delay(30);
        return HttpResponse.json(CLIENT_TEST);
      }),
      http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
      http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
      http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
      http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
    );
    const { container } = rendreEcran();

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
  });

  it("affiche un état d'erreur actionnable si la fiche ne charge pas", async () => {
    server.use(
      http.get('/api/v1/clients/cl-1', () =>
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
      // Les panneaux latéraux (véhicules/OR) et l'onglet actif interrogent des endpoints
      // indépendants de `GET /clients/{id}` — mockés ici pour ne pas polluer le test d'une
      // requête non gérée, même si l'écran affiche l'erreur avant de les exploiter.
      http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
      http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
      http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
      http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
    );
    rendreEcran();

    expect(await screen.findByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
  });

  it('traduit les libellés en allemand', async () => {
    await i18n.changeLanguage('de');
    repondreFicheOk();
    rendreEcran();

    expect(await screen.findByText('Kein Fahrzeug zugeordnet.')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Kontakte' })).toBeInTheDocument();
  });

  describe('propagation du site (?site=) aux liens sortants', () => {
    function repondreAvecVehiculeEtOr() {
      server.use(
        http.get('/api/v1/clients/cl-1', () => HttpResponse.json(CLIENT_TEST)),
        http.get('/api/v1/clients/cl-1/vehicules', () =>
          HttpResponse.json({ ...PAGE_VIDE, donnees: [VEHICULE_TEST] }),
        ),
        http.get('/api/v1/clients/cl-1/ordres-reparation', () =>
          HttpResponse.json({ ...PAGE_VIDE, donnees: [OR_TEST] }),
        ),
        http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
      );
    }

    it('conserve `?site=` en ouvrant un véhicule rattaché', async () => {
      repondreAvecVehiculeEtOr();
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients/cl-1?site=site-1');

      await utilisateur.click(await screen.findByText('VW Touran 2.0 TDI'));

      expect(await screen.findByText('PAGE_VEHICULE')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/vehicules/veh-1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('ne réinvente pas de `site` en ouvrant un véhicule rattaché quand il est absent de l’URL', async () => {
      repondreAvecVehiculeEtOr();
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients/cl-1');

      await utilisateur.click(await screen.findByText('VW Touran 2.0 TDI'));

      expect(await screen.findByText('PAGE_VEHICULE')).toBeInTheDocument();
      expect(routeur.state.location.search).toBe('');
    });

    it('conserve `?site=` en ouvrant un OR récent', async () => {
      repondreAvecVehiculeEtOr();
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients/cl-1?site=site-1');

      await utilisateur.click(await screen.findByText('OR-000123'));

      expect(await screen.findByText('PAGE_OR')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/ordres-reparation/or-1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('conserve `?site=` en cliquant « Ouvrir un OR »', async () => {
      repondreFicheOk();
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients/cl-1?site=site-1');

      await utilisateur.click(await screen.findByRole('button', { name: 'Ouvrir un OR' }));

      expect(await screen.findByText('PAGE_NOUVEL_OR')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/atelier/ordres-reparation/nouveau');
      expect(routeur.state.location.search).toBe('?clientId=cl-1&site=site-1');
    });

    it('ne réinvente pas de `site` en cliquant « Ouvrir un OR » quand il est absent de l’URL', async () => {
      repondreFicheOk();
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients/cl-1');

      await utilisateur.click(await screen.findByRole('button', { name: 'Ouvrir un OR' }));

      expect(await screen.findByText('PAGE_NOUVEL_OR')).toBeInTheDocument();
      expect(routeur.state.location.search).toBe('?clientId=cl-1');
    });
  });
});
