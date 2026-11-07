import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranOrdreDepuisPlaque } from './EcranOrdreDepuisPlaque';

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const SITE_ID = 'site-1';

const PARAMETRES_ATELIER = {
  reception: { kmEntreeObligatoire: false },
  or: { etatPlanifieActif: false },
};

const CLIENT_EXISTANT = {
  id: 'c1',
  numeroClient: 'C-1',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: '079 111 22 33',
  dernierPassageLe: null,
  notesAlerte: [],
};

function resultatVehicule(id: string, historique = false) {
  return {
    type: 'vehicule',
    id,
    score: 1,
    correspondance: { champ: 'plaque', valeur: 'VD123456', historique },
    resume: {
      designation: 'VW Golf 7',
      plaque: 'VD123456',
      detenteurNom: 'Jean Dupont',
    },
  };
}

function contexteAtelierVide(vehiculeId: string) {
  return {
    vehicule: { id: vehiculeId },
    detenteurCourant: null,
    dernierKilometrage: null,
    expertise: null,
    garantie: { constructeur: null, garage: null },
    campagnesOuvertes: [],
    travauxReportes: { total: 0, elements: [] },
    alertesClient: [],
    ordresReparationOuverts: [],
    depotPneus: null,
    avertissements: [],
  };
}

function orCree() {
  return {
    donnees: { id: 'or-9', numero: 'OR-9', client: { id: 'c1' } },
    avertissements: [],
  };
}

function handlersCommuns() {
  return [
    http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
    http.get('/api/v1/parametres-atelier', () => HttpResponse.json(PARAMETRES_ATELIER)),
    http.get('/api/v1/referentiels/vehicules/marques', () => HttpResponse.json({ marques: [] })),
    http.get('/api/v1/referentiels/vehicules/modeles', () => HttpResponse.json({ modeles: [] })),
  ];
}

function rendre(route: string) {
  return renduAvecRoutes(
    [
      { path: '/atelier/ordres-reparation/depuis-plaque', element: <EcranOrdreDepuisPlaque /> },
      { path: '/ordres-reparation/:orId', element: <div>PAGE_FICHE_OR</div> },
    ],
    { routeInitiale: route },
  );
}

describe('EcranOrdreDepuisPlaque', () => {
  it('véhicule connu : la plaque retrouve véhicule et détenteur, une seule validation ouvre l’OR', async () => {
    const corps: Record<string, unknown>[] = [];
    server.use(
      ...handlersCommuns(),
      http.get('/api/v1/recherche', () =>
        HttpResponse.json({ resultats: [resultatVehicule('v1')], plaqueInterchangeable: false }),
      ),
      http.get('/api/v1/vehicules/v1/detentions', () =>
        HttpResponse.json([
          {
            id: 'd1',
            client: { id: 'c1', numeroClient: 'C-1', nomAffiche: 'Jean Dupont' },
            debutLe: '2026-01-01',
            finLe: null,
            motifFin: null,
          },
        ]),
      ),
      http.get('/api/v1/clients/c1', () => HttpResponse.json(CLIENT_EXISTANT)),
      http.get('/api/v1/vehicules/v1/contexte-atelier', () =>
        HttpResponse.json(contexteAtelierVide('v1')),
      ),
      http.post('/api/v1/ordres-reparation', async ({ request }) => {
        corps.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(orCree(), { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    const { routeur } = rendre(
      `/atelier/ordres-reparation/depuis-plaque?site=${SITE_ID}&plaque=VD123456`,
    );

    // Véhicule reconnu tout seul, client = détenteur, sans aucune autre saisie.
    expect(await screen.findByText('VD 123456')).toBeInTheDocument();
    expect(await screen.findByText('Détenteur du véhicule')).toBeInTheDocument();

    await utilisateur.type(screen.getByLabelText('Demande du client'), 'Bruit au freinage');
    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));

    await waitFor(() => expect(screen.getByText('PAGE_FICHE_OR')).toBeInTheDocument());
    expect(corps).toHaveLength(1);
    expect(corps[0]).toMatchObject({
      siteId: SITE_ID,
      clientId: 'c1',
      vehiculeId: 'v1',
      type: 'reparation',
      demandes: [{ verbatim: 'Bruit au freinage' }],
    });
    expect(routeur.state.location.pathname).toBe('/ordres-reparation/or-9');
  });

  it('plaque ancienne : le véhicule n’est jamais choisi à la place de l’utilisateur', async () => {
    server.use(
      ...handlersCommuns(),
      http.get('/api/v1/recherche', () =>
        HttpResponse.json({
          resultats: [resultatVehicule('v1', true)],
          plaqueInterchangeable: false,
        }),
      ),
    );
    rendre(`/atelier/ordres-reparation/depuis-plaque?site=${SITE_ID}&plaque=VD123456`);

    expect(await screen.findByRole('radio', { name: /VW Golf 7/ })).toBeInTheDocument();
    expect(screen.getByText('Ancienne plaque')).toBeInTheDocument();
    expect(screen.queryByText('Détenteur du véhicule')).not.toBeInTheDocument();
  });

  it('véhicule inconnu + nouveau client : client, véhicule puis OR sont créés dans cet ordre', async () => {
    const appels: string[] = [];
    const corpsVehicule: Record<string, unknown>[] = [];
    const corpsOr: Record<string, unknown>[] = [];
    server.use(
      ...handlersCommuns(),
      http.get('/api/v1/recherche', () =>
        HttpResponse.json({ resultats: [], plaqueInterchangeable: false }),
      ),
      http.get('/api/v1/doublons-clients', () => HttpResponse.json({ candidats: [] })),
      http.post('/api/v1/clients', async ({ request }) => {
        appels.push('client');
        const corps = (await request.json()) as { nom: string; telephones: unknown };
        expect(corps).toMatchObject({
          type: 'particulier',
          nom: 'Martin',
          telephones: [{ valeur: '079 123 45 67', principal: true }],
        });
        return HttpResponse.json(
          {
            donnees: { ...CLIENT_EXISTANT, id: 'c-new', nomAffiche: 'Martin' },
            avertissements: [],
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/vehicules', async ({ request }) => {
        appels.push('vehicule');
        corpsVehicule.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(
          { donnees: { id: 'v-new', designation: 'Audi A3', plaque: null }, avertissements: [] },
          { status: 201 },
        );
      }),
      http.get('/api/v1/clients/c-new', () =>
        HttpResponse.json({ ...CLIENT_EXISTANT, id: 'c-new', nomAffiche: 'Martin' }),
      ),
      http.get('/api/v1/vehicules/v-new/contexte-atelier', () =>
        HttpResponse.json(contexteAtelierVide('v-new')),
      ),
      http.post('/api/v1/ordres-reparation', async ({ request }) => {
        appels.push('or');
        corpsOr.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(orCree(), { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre(`/atelier/ordres-reparation/depuis-plaque?site=${SITE_ID}&plaque=ZZ999`);

    expect(await screen.findByText(/Plaque inconnue/)).toBeInTheDocument();
    await utilisateur.type(screen.getByLabelText(/Marque/), 'Audi');
    await utilisateur.type(screen.getByLabelText(/Modèle/), 'A3');
    await utilisateur.click(screen.getByRole('button', { name: 'Nouveau client' }));
    await utilisateur.type(screen.getByLabelText(/Nom du client/), 'Martin');
    await utilisateur.type(screen.getByLabelText(/Téléphone/), '079 123 45 67');
    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));

    await waitFor(() => expect(screen.getByText('PAGE_FICHE_OR')).toBeInTheDocument());
    expect(appels).toEqual(['client', 'vehicule', 'or']);
    expect(corpsVehicule[0]).toMatchObject({
      marque: 'Audi',
      modele: 'A3',
      plaque: 'ZZ999',
      detenteurId: 'c-new',
    });
    expect(corpsOr[0]).toMatchObject({ clientId: 'c-new', vehiculeId: 'v-new' });
  });

  it('échec partiel : le client déjà créé est dit et conservé, le second essai ne le recrée pas', async () => {
    let creationsClient = 0;
    let essaisVehicule = 0;
    server.use(
      ...handlersCommuns(),
      http.get('/api/v1/recherche', () =>
        HttpResponse.json({ resultats: [], plaqueInterchangeable: false }),
      ),
      http.get('/api/v1/doublons-clients', () => HttpResponse.json({ candidats: [] })),
      http.post('/api/v1/clients', () => {
        creationsClient += 1;
        return HttpResponse.json(
          {
            donnees: { ...CLIENT_EXISTANT, id: 'c-new', nomAffiche: 'Martin' },
            avertissements: [],
          },
          { status: 201 },
        );
      }),
      http.post('/api/v1/vehicules', () => {
        essaisVehicule += 1;
        if (essaisVehicule === 1) {
          return HttpResponse.json(
            {
              type: 'about:blank',
              title: 'Erreur',
              status: 500,
              code: 'ERREUR_INTERNE',
              detail: 'Panne',
            },
            { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json(
          { donnees: { id: 'v-new', designation: 'Audi A3', plaque: null }, avertissements: [] },
          { status: 201 },
        );
      }),
      http.get('/api/v1/clients/c-new', () =>
        HttpResponse.json({ ...CLIENT_EXISTANT, id: 'c-new', nomAffiche: 'Martin' }),
      ),
      http.get('/api/v1/vehicules/v-new/contexte-atelier', () =>
        HttpResponse.json(contexteAtelierVide('v-new')),
      ),
      http.post('/api/v1/ordres-reparation', () => HttpResponse.json(orCree(), { status: 201 })),
    );
    const utilisateur = userEvent.setup();
    rendre(`/atelier/ordres-reparation/depuis-plaque?site=${SITE_ID}&plaque=ZZ999`);

    await screen.findByText(/Plaque inconnue/);
    await utilisateur.type(screen.getByLabelText(/Marque/), 'Audi');
    await utilisateur.type(screen.getByLabelText(/Modèle/), 'A3');
    await utilisateur.click(screen.getByRole('button', { name: 'Nouveau client' }));
    await utilisateur.type(screen.getByLabelText(/Nom du client/), 'Martin');
    await utilisateur.type(screen.getByLabelText(/Téléphone/), '079 123 45 67');
    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent("Le véhicule n'a pas pu être créé");
    expect(alerte).toHaveTextContent('Client créé.');
    // Saisie conservée.
    expect(screen.getByLabelText(/Nom du client/)).toHaveValue('Martin');

    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByText('PAGE_FICHE_OR')).toBeInTheDocument());
    expect(creationsClient).toBe(1);
    expect(essaisVehicule).toBe(2);
  });

  it('validation : dit champ par champ ce qui manque, sans rien créer', async () => {
    server.use(
      ...handlersCommuns(),
      http.get('/api/v1/recherche', () =>
        HttpResponse.json({ resultats: [], plaqueInterchangeable: false }),
      ),
    );
    const utilisateur = userEvent.setup();
    rendre(`/atelier/ordres-reparation/depuis-plaque?site=${SITE_ID}&plaque=ZZ999`);

    await screen.findByText(/Plaque inconnue/);
    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));

    expect(await screen.findByText('Choisissez un client, ou créez-en un.')).toBeInTheDocument();
    expect(screen.getAllByText('Ce champ est obligatoire.').length).toBeGreaterThan(0);
  });
});
