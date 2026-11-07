import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';

import '@/i18n';

import { obtenirToastsSucces } from '@/composants/motifs/toast-succes';
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

function creationRapideReussie(avertissements: unknown[] = []) {
  return {
    donnees: {
      client: { id: 'c-new' },
      vehicule: { id: 'v-new' },
      ordreReparation: { id: 'or-9', numero: 'OR-9', client: { id: 'c-new' } },
    },
    avertissements,
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
      http.post('/api/v1/ordres-reparation/creation-rapide', async ({ request }) => {
        corps.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(creationRapideReussie(), { status: 201 });
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
      client: { id: 'c1' },
      vehicule: { id: 'v1' },
      or: { siteId: SITE_ID, type: 'reparation', demandes: [{ verbatim: 'Bruit au freinage' }] },
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

  async function remplirNouveauClientEtVehicule(utilisateur: ReturnType<typeof userEvent.setup>) {
    await screen.findByText(/Plaque inconnue/);
    await utilisateur.type(screen.getByLabelText(/Marque/), 'Audi');
    await utilisateur.type(screen.getByLabelText(/Modèle/), 'A3');
    await utilisateur.click(screen.getByRole('button', { name: 'Nouveau client' }));
    await utilisateur.type(screen.getByLabelText(/Nom du client/), 'Martin');
    await utilisateur.type(screen.getByLabelText(/Téléphone/), '079 123 45 67');
    await utilisateur.click(screen.getByRole('button', { name: "Ouvrir l'ordre de réparation" }));
  }

  it('véhicule inconnu + nouveau client : UN seul appel porte client, véhicule et OR', async () => {
    const appels: { cle: string | null; corps: Record<string, unknown> }[] = [];
    let appelsSepares = 0;
    server.use(
      ...handlersCommuns(),
      http.get('/api/v1/recherche', () =>
        HttpResponse.json({ resultats: [], plaqueInterchangeable: false }),
      ),
      http.get('/api/v1/doublons-clients', () => HttpResponse.json({ candidats: [] })),
      http.post('/api/v1/clients', () => {
        appelsSepares += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.post('/api/v1/vehicules', () => {
        appelsSepares += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.post('/api/v1/ordres-reparation', () => {
        appelsSepares += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
      http.post('/api/v1/ordres-reparation/creation-rapide', async ({ request }) => {
        appels.push({
          cle: request.headers.get('Idempotency-Key'),
          corps: (await request.json()) as Record<string, unknown>,
        });
        return HttpResponse.json(
          creationRapideReussie([{ code: 'CLIENT_DOUBLON_PROBABLE', message: 'x', donnees: {} }]),
          { status: 201 },
        );
      }),
    );
    const utilisateur = userEvent.setup();
    rendre(`/atelier/ordres-reparation/depuis-plaque?site=${SITE_ID}&plaque=ZZ999`);
    await remplirNouveauClientEtVehicule(utilisateur);

    await waitFor(() => expect(screen.getByText('PAGE_FICHE_OR')).toBeInTheDocument());
    expect(appelsSepares).toBe(0);
    expect(appels).toHaveLength(1);
    expect(appels[0]?.cle).toBeTruthy();
    expect(appels[0]?.corps).toMatchObject({
      client: {
        nouveau: {
          type: 'particulier',
          nom: 'Martin',
          telephone: '079 123 45 67',
          langueCorrespondance: 'fr',
        },
      },
      vehicule: { nouveau: { marque: 'Audi', modele: 'A3', plaque: 'ZZ999' } },
      or: { siteId: SITE_ID },
    });
    // Doublon probable : jamais bloquant, signalé.
    expect(
      obtenirToastsSucces()
        .map((toast) => toast.message)
        .join(' '),
    ).toMatch(/client très semblable existe déjà/);
  });

  it('échec : la saisie est conservée et le nouvel essai rejoue la MÊME clé d’idempotence', async () => {
    const cles: (string | null)[] = [];
    server.use(
      ...handlersCommuns(),
      http.get('/api/v1/recherche', () =>
        HttpResponse.json({ resultats: [], plaqueInterchangeable: false }),
      ),
      http.get('/api/v1/doublons-clients', () => HttpResponse.json({ candidats: [] })),
      http.post('/api/v1/ordres-reparation/creation-rapide', ({ request }) => {
        cles.push(request.headers.get('Idempotency-Key'));
        if (cles.length === 1) {
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
        return HttpResponse.json(creationRapideReussie(), { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    rendre(`/atelier/ordres-reparation/depuis-plaque?site=${SITE_ID}&plaque=ZZ999`);
    await remplirNouveauClientEtVehicule(utilisateur);

    const alerte = await screen.findByRole('alert');
    expect(alerte).toHaveTextContent('L’OR n’a pas pu être ouvert');
    expect(screen.getByLabelText(/Nom du client/)).toHaveValue('Martin');

    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => expect(screen.getByText('PAGE_FICHE_OR')).toBeInTheDocument());
    expect(cles).toHaveLength(2);
    expect(cles[1]).toBe(cles[0]);
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
