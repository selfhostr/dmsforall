import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { OrdreReparationResume, ReponseClient, VehiculeResume } from '@dfa/shared';

import i18n from '@/i18n';
import { SESSION_TEST } from '@/test/msw/handlers';
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

/** Reproduit ce que fait RÉELLEMENT `EcranListeClients` après une création réussie (issue #79) :
 *  `navigate(chemins.clients.detail(id, site), { state: {...} })`. `renduAvecRoutes` (test/utils,
 *  hors périmètre d'écriture ici) ne prend qu'un chemin brut en route initiale — pas d'état — donc
 *  ce lanceur atterrit d'abord sur une route neutre puis navigue LUI-MÊME avec l'état voulu, par
 *  les seuls hooks publics de `react-router`, sans toucher au harnais partagé. */
function rendreEcranDepuisCreation(etat: { clientCreeNumero: string; clientCreeNom: string }) {
  function Lanceur() {
    const navigate = useNavigate();
    useEffect(() => {
      navigate('/clients/cl-1', { state: etat, replace: true });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return null;
  }
  return renduAvecRoutes(
    [
      { path: '/depart', element: <Lanceur /> },
      { path: '/clients', element: <div>PAGE_LISTE_CLIENTS</div> },
      { path: '/clients/:id', element: <EcranFicheClient /> },
    ],
    { routeInitiale: '/depart' },
  );
}

function repondreFicheOk(client: typeof CLIENT_TEST = CLIENT_TEST) {
  server.use(
    http.get('/api/v1/clients/cl-1', () => HttpResponse.json(client)),
    http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
    http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
    // Lot B (`docs/plan-refonte-navigation.md`) — « ses dossiers de vente », troisième liste.
    // Sans mock de session, `useSession` résout `data: null` (401 par défaut, voir
    // `test/msw/handlers.ts`) : `peutLireDossierVente(undefined)` est `false`, la requête
    // `enabled: false` ne part JAMAIS (correctif RF-115). Ce handler reste enregistré pour les
    // tests qui mockent explicitement une session autorisée (`repondreFicheOk` avec
    // `server.use(http.get('/api/v1/auth/moi', ...))` en plus).
    http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
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

  // Chantier « titres doublés & espacements » (17.08.2026) : `GabaritEcran` force ce h1 en
  // `sr-only` (contenu déjà affiché en gros caractères par `IdentiteClient`, voir le commentaire
  // de `EcranFicheClient.tsx`) — présent dans le DOM pour un lecteur d'écran, jamais retiré, mais
  // masqué visuellement. La classe posée par le gabarit est la preuve fiable ici — `toBeVisible()`
  // (jest-dom) ne détecte pas la technique `position: absolute; clip: …` d'une classe `sr-only`
  // sans feuille de style chargée (jsdom, ces tests).
  it('garde un h1 accessible « Fiche client » dans le DOM, masqué via `sr-only`', async () => {
    repondreFicheOk();
    rendreEcran();

    const titre = await screen.findByRole('heading', { level: 1, name: 'Fiche client' });
    expect(titre).toBeInTheDocument();
    expect(titre.className).toMatch(/\bsr-only\b/);
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
      http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
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
      http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
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
        http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
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

  // Défaut mesuré en navigateur (connecté `admin`, rôle SANS `ventes.dossier.lire`, RF-115) :
  // « Dossiers de vente » affichait « Aucun dossier de vente. » — un refus de droit rendu comme
  // une absence — puis martelait le serveur en boucle (six requêtes 403 en moins de dix secondes,
  // `useListeDossiersVente` réessayant indéfiniment un état stable). Ces tests ÉCHOUAIENT avec
  // l'ancien comportement : le premier trouvait « Aucun dossier de vente. » au lieu du message de
  // refus, le second aurait vu la requête interdite partir malgré tout.
  describe('dossiers de vente — refus de droit distinct d’une absence (RF-115)', () => {
    function mockerSessionRole(role: (typeof SESSION_TEST)['utilisateur']['role']) {
      server.use(
        http.get('/api/v1/auth/moi', () =>
          HttpResponse.json({
            ...SESSION_TEST,
            utilisateur: { ...SESSION_TEST.utilisateur, role },
          }),
        ),
      );
    }

    it(
      "affiche le refus de droit — jamais « aucun dossier » — et n'insiste pas quand le " +
        'serveur répond 403 malgré un rôle autorisé côté front',
      async () => {
        // `chef_atelier` est autorisé par `peutLireDossierVente` (matrice front) : la requête part
        // bel et bien. Le serveur répond 403 quand même (matrice réelle plus stricte, ou dérive) —
        // c'est CE cas que `useListeDossiersVente` doit traiter sans jamais réessayer en boucle.
        mockerSessionRole('chef_atelier');
        let nombreAppels = 0;
        server.use(
          http.get('/api/v1/clients/cl-1', () => HttpResponse.json(CLIENT_TEST)),
          http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/dossiers-vente', () => {
            nombreAppels += 1;
            return HttpResponse.json(
              {
                type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
                title: 'Droit insuffisant',
                status: 403,
                code: 'DROIT_INSUFFISANT',
                instance: 'req-403',
              },
              { status: 403, headers: { 'content-type': 'application/problem+json' } },
            );
          }),
        );

        rendreEcran();

        expect(
          await screen.findByText("Vous n'avez pas les droits pour cette action."),
        ).toBeInTheDocument();
        expect(screen.queryByText('Aucun dossier de vente.')).not.toBeInTheDocument();
        // Politique de réessai (`useListeDossiersVente` : `retry: false` sur 403/404) — un seul
        // appel, jamais le martèlement mesuré en navigateur (six requêtes en moins de dix
        // secondes avec l'ancien comportement).
        expect(nombreAppels).toBe(1);
      },
    );

    it(
      "n'interroge JAMAIS le serveur et affiche le message de droit requis pour `admin` " +
        '(RF-115 : aucun droit `ventes.*`)',
      async () => {
        mockerSessionRole('admin');
        let nombreAppels = 0;
        server.use(
          http.get('/api/v1/clients/cl-1', () => HttpResponse.json(CLIENT_TEST)),
          http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
          http.get('/api/v1/dossiers-vente', () => {
            nombreAppels += 1;
            return HttpResponse.json(PAGE_VIDE);
          }),
        );

        rendreEcran();

        expect(
          await screen.findByText(
            "Vous n'avez pas le droit de consulter les dossiers de vente de ce client.",
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText('Aucun dossier de vente.')).not.toBeInTheDocument();
        expect(nombreAppels).toBe(0);
      },
    );
  });

  describe('issue #79 — le client Rossier avait bien été créé malgré un message d’échec', () => {
    // Verbatim terrain : « Connexion impossible », recliqué, « Une erreur s'est produite » avec un
    // « Réessayer » qui ne réparait rien — le client existait pourtant déjà (CL-000013). Cause
    // mesurée : la CRÉATION avait réussi (`EcranListeClients` avait déjà navigué ici), seule la
    // LECTURE `GET /clients/{id}` qui suit cette navigation échouait à son tour — voir le
    // commentaire d'`EtatNavigationClientCree` dans `EcranFicheClient.tsx`.
    function repondreLectureEchoue(status: number, code: string) {
      server.use(
        http.get('/api/v1/clients/cl-1', () =>
          HttpResponse.json(
            {
              type: `https://docs.dmsforall.example/erreurs/${code}`,
              title: code,
              status,
              code,
              instance: 'req-fiche-apres-creation',
            },
            { status, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
        http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
      );
    }

    it("dit que le client a bien été créé — jamais le message générique d'échec — quand la lecture échoue juste après une création confirmée", async () => {
      repondreLectureEchoue(500, 'ERREUR_INTERNE');
      rendreEcranDepuisCreation({ clientCreeNumero: 'CL-000013', clientCreeNom: 'Jean Rossier' });

      expect(await screen.findByText('Client enregistré')).toBeInTheDocument();
      expect(
        screen.getByText(
          "Le client Jean Rossier a bien été enregistré (CL-000013), mais sa fiche n'a pas pu s'afficher. Réessayez, ou retrouvez-le depuis la liste des clients — ne le recréez pas.",
        ),
      ).toBeInTheDocument();
      // Jamais les messages génériques qui laissent croire que rien n'a abouti.
      expect(screen.queryByText("Une erreur s'est produite")).not.toBeInTheDocument();
      expect(screen.queryByText('Connexion impossible')).not.toBeInTheDocument();
    });

    it('affiche le même message rassurant même quand la lecture qui suit échoue pour une cause RÉSEAU (pas seulement un 500)', async () => {
      // La cause exacte de l'échec de LECTURE n'a aucune importance pour l'utilisateur ici : ce
      // qui compte est que la CRÉATION, elle, a réussi. `HttpResponse.error()` simule une panne
      // réseau (`fetch` qui rejette), exactement le type d'erreur qui affichait « Connexion
      // impossible » avant ce correctif.
      server.use(
        http.get('/api/v1/clients/cl-1', () => HttpResponse.error()),
        http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
      );
      rendreEcranDepuisCreation({ clientCreeNumero: 'CL-000013', clientCreeNom: 'Jean Rossier' });

      expect(await screen.findByText('Client enregistré')).toBeInTheDocument();
      expect(screen.queryByText('Connexion impossible')).not.toBeInTheDocument();
    });

    it('« Réessayer » relit la fiche (pas une recréation) et « Retour à la liste des clients » permet de retrouver le client sans le ressaisir', async () => {
      let nombreAppelsLecture = 0;
      server.use(
        http.get('/api/v1/clients/cl-1', () => {
          nombreAppelsLecture += 1;
          return HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
              title: 'Erreur interne',
              status: 500,
              code: 'ERREUR_INTERNE',
              instance: 'req-fiche-apres-creation',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }),
        http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
      );
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcranDepuisCreation({
        clientCreeNumero: 'CL-000013',
        clientCreeNom: 'Jean Rossier',
      });

      await screen.findByText('Client enregistré');
      const appelsAvantReessai = nombreAppelsLecture;
      await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));
      expect(nombreAppelsLecture).toBeGreaterThan(appelsAvantReessai);
      // Aucune requête de CRÉATION n'est jamais partie ici — seul `GET /clients/cl-1` a été
      // rappelé. `onUnhandledRequest: 'error'` (test/setup.ts) ferait de toute façon échouer ce
      // test si un `POST /clients` inattendu partait.

      await utilisateur.click(
        screen.getByRole('button', { name: 'Retour à la liste des clients' }),
      );
      expect(routeur.state.location.pathname).toBe('/clients');
    });

    it("n'affiche PAS ce message rassurant sur un accès direct à la fiche (aucun état de création — comportement générique inchangé)", async () => {
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
        http.get('/api/v1/clients/cl-1/vehicules', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/ordres-reparation', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/conditions', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/clients/cl-1/contacts', () => HttpResponse.json(PAGE_VIDE)),
        http.get('/api/v1/dossiers-vente', () => HttpResponse.json(PAGE_VIDE)),
      );
      rendreEcran();

      expect(await screen.findByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
      expect(screen.queryByText('Client enregistré')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retour à la liste des clients' }),
      ).not.toBeInTheDocument();
    });
  });
});
