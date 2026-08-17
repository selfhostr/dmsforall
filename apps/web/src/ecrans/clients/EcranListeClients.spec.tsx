import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ClientResume, ReponseClient, ReponseDoublonsClients } from '@dfa/shared';

import i18n from '@/i18n';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranListeClients } from './EcranListeClients';

const CLIENT_TEST: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: '+41791234567',
  localite: 'Lausanne',
  nombreVehicules: 2,
  dernierPassageLe: '2026-06-01T10:00:00.000Z',
};

const LISTE_VIDE = { donnees: [], curseurSuivant: null, limite: 50 };

const CLIENT_CREE: ReponseClient = {
  id: 'cl-42',
  numeroClient: 'CL-000042',
  type: 'particulier',
  statut: 'actif',
  civilite: null,
  nom: 'Rossier',
  prenom: 'Jean',
  raisonSociale: null,
  nomAffiche: 'Jean Rossier',
  ide: null,
  langueCorrespondance: 'fr',
  email: null,
  telephone: null,
  telephoneE164: null,
  poObligatoire: false,
  groupeId: null,
  fusionneVersClientId: null,
  referenceExterne: null,
  dernierPassageLe: null,
  creeLe: '2026-08-12T08:00:00.000Z',
  modifieLe: '2026-08-12T08:00:00.000Z',
  notesAlerte: [],
  plusAucunContact: false,
  motif: null,
};

function rendreEcran(routeInitiale = '/clients') {
  return renduAvecRoutes(
    [
      { path: '/clients', element: <EcranListeClients /> },
      { path: '/clients/:id', element: <div>PAGE_FICHE_CLIENT</div> },
    ],
    { routeInitiale },
  );
}

function repondreListe(donnees: readonly ClientResume[]) {
  server.use(
    http.get('/api/v1/clients', () =>
      HttpResponse.json({ donnees, curseurSuivant: null, limite: 50 }),
    ),
  );
}

/** Liste vide ET aperçu de doublons neutralisé (`GET /doublons-clients`, sollicité dès la
 *  première frappe dans le tiroir « Nouveau client ») — nécessaire pour les scénarios issue #78/
 *  #79 ci-dessous, qui ouvrent systématiquement ce tiroir. */
function repondreListeVide() {
  server.use(
    http.get('/api/v1/clients', () => HttpResponse.json(LISTE_VIDE)),
    http.get('/api/v1/doublons-clients', () =>
      HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
    ),
  );
}

/** Liste VIDE (`repondreListeVide`) : DEUX boutons portent le nom accessible « Nouveau client »
 *  une fois `EtatVidePremierUsage` rendu — celui de l'en-tête (toujours présent, premier dans le
 *  DOM) et celui de l'état vide. Le premier, systématiquement, jamais `getByRole` seul (ambigu dès
 *  que la liste vide a fini de se rendre). */
async function boutonNouveauClient() {
  const boutons = await screen.findAllByRole('button', { name: 'Nouveau client' });
  const bouton = boutons[0];
  if (!bouton) throw new Error('Bouton « Nouveau client » introuvable.');
  return bouton;
}

async function ouvrirTiroirEtTaper(
  utilisateur: ReturnType<typeof userEvent.setup>,
  texte = 'Rossier',
) {
  await utilisateur.click(await boutonNouveauClient());
  await screen.findByLabelText('Nom');
  await utilisateur.type(screen.getByLabelText('Nom'), texte);
}

describe('EcranListeClients', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  // Le brouillon (issue #78) vit dans `sessionStorage` sous une clé CONSTANTE — sans ce nettoyage,
  // un brouillon écrit par un test bloquerait le garde-fou d'un test SUIVANT qui n'en veut pas
  // (jsdom ne réinitialise pas `sessionStorage` entre les `it` d'un même fichier).
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('affiche les clients renvoyés par le serveur', async () => {
    repondreListe([CLIENT_TEST]);
    rendreEcran();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText('CL-000123')).toBeInTheDocument();
    expect(screen.getByText('Lausanne')).toBeInTheDocument();
  });

  // Chantier « titres doublés & espacements » (re-arbitrage @laupernoe du 17.08.2026, ANNULE le retour du
  // 12.08.2026 qui demandait ce même h1 visible — voir le commentaire de `EcranListeClients.tsx`) :
  // l'onglet actif « Clients » (`OngletsDomaine`) porte déjà ce libellé, `GabaritEcran` doit donc
  // garder le h1 dans le DOM (lecteur d'écran) mais masqué visuellement, jamais retiré. La classe
  // posée par le gabarit (`cn('texte-titre-page', !titreVisible && 'sr-only')`) est la preuve
  // fiable ici — `toBeVisible()` (jest-dom) ne teste que `display`/`visibility`/`opacity`/`hidden`,
  // jamais la technique `position: absolute; clip: …` d'une classe `sr-only`, et aucune feuille de
  // style n'est chargée dans ces tests (jsdom) : cette assertion resterait verte même sans masquage.
  it('garde un h1 accessible « Clients » dans le DOM, masqué via `sr-only` (doublon avec l’onglet actif)', async () => {
    repondreListe([CLIENT_TEST]);
    rendreEcran();

    const titre = await screen.findByRole('heading', { level: 1, name: 'Clients' });
    expect(titre).toBeInTheDocument();
    expect(titre.className).toMatch(/\bsr-only\b/);
  });

  it('affiche des lignes squelette pendant le chargement', async () => {
    server.use(
      http.get('/api/v1/clients', async () => {
        await delay(30);
        return HttpResponse.json({ donnees: [CLIENT_TEST], curseurSuivant: null, limite: 50 });
      }),
    );
    const { container } = rendreEcran();

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
  });

  it("affiche l'état « premier usage » quand la liste est vide sans filtre actif", async () => {
    repondreListe([]);
    rendreEcran();

    expect(
      await screen.findByText('Aucun client enregistré. Créez le premier.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Nouveau client' }).length).toBeGreaterThan(0);
  });

  it("affiche un état d'erreur actionnable si le serveur répond en erreur", async () => {
    server.use(
      http.get('/api/v1/clients', () =>
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
    rendreEcran();

    expect(await screen.findByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
  });

  it('traduit les libellés en allemand', async () => {
    await i18n.changeLanguage('de');
    repondreListe([]);
    rendreEcran();

    expect(
      await screen.findByText('Kein Kunde registriert. Erstellen Sie den ersten.'),
    ).toBeInTheDocument();
  });

  describe('propagation du site (?site=) au clic sur une ligne', () => {
    it('conserve `?site=` en ouvrant la fiche client', async () => {
      repondreListe([CLIENT_TEST]);
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients?site=site-1');

      await utilisateur.click(await screen.findByText('Jean Dupont'));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/clients/cl-1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('ne réinvente pas de `site` en ouvrant la fiche client quand il est absent de l’URL', async () => {
      repondreListe([CLIENT_TEST]);
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients');

      await utilisateur.click(await screen.findByText('Jean Dupont'));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.search).toBe('');
    });
  });

  describe('issue #78 — le panneau « Nouveau client » se refermait tout seul pendant la saisie', () => {
    it("bloque la fermeture sur Échap tant qu'une saisie réelle est en cours", async () => {
      repondreListeVide();
      const utilisateur = userEvent.setup();
      rendreEcran();

      await ouvrirTiroirEtTaper(utilisateur);
      await utilisateur.keyboard('{Escape}');

      // Le panneau reste ouvert ET la saisie reste intacte — la touche Échap n'a RIEN dû faire.
      expect(screen.getByLabelText('Nom')).toHaveValue('Rossier');
      expect(screen.getByRole('button', { name: 'Créer le client' })).toBeInTheDocument();
    });

    it("bloque la fermeture sur un clic hors du panneau tant qu'une saisie réelle est en cours", async () => {
      repondreListeVide();
      const utilisateur = userEvent.setup();
      rendreEcran();

      await ouvrirTiroirEtTaper(utilisateur);
      // La zone grisée hors du panneau (`SheetOverlay`, `components/ui/sheet.tsx`) reçoit le clic
      // — Radix pose `pointer-events: none` sur le reste de `<body>` tant que le tiroir est ouvert,
      // un clic « au hasard » retombe donc toujours sur cette zone, jamais ailleurs. Sélecteur par
      // classe faute d'attribut dédié dans `SheetOverlay` (composant partagé, lecture seule ici).
      const voile = document.querySelector('.animation-voile');
      expect(voile).not.toBeNull();
      await utilisateur.click(voile as Element);

      expect(screen.getByLabelText('Nom')).toHaveValue('Rossier');
      expect(screen.getByRole('button', { name: 'Créer le client' })).toBeInTheDocument();
    });

    it("laisse Échap fermer normalement un tiroir VIDE — le garde-fou ne bloque QUE s'il y a quelque chose à perdre", async () => {
      repondreListeVide();
      const utilisateur = userEvent.setup();
      rendreEcran();

      await utilisateur.click(await boutonNouveauClient());
      await screen.findByLabelText('Nom');
      await utilisateur.keyboard('{Escape}');

      expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument();
    });

    it('le bouton de fermeture visible reste une fermeture EXPLICITE, toujours autorisée même avec une saisie en cours', async () => {
      repondreListeVide();
      const utilisateur = userEvent.setup();
      rendreEcran();

      await ouvrirTiroirEtTaper(utilisateur);
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer' }));

      expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument();
    });

    it('une saisie perdue par une fermeture accidentelle est restaurée à la réouverture, annoncée par un bandeau', async () => {
      repondreListeVide();
      const utilisateur = userEvent.setup();
      rendreEcran();

      await ouvrirTiroirEtTaper(utilisateur);
      // Échap est bloqué tant que la saisie est en jeu (voir le test dédié plus haut) : ce test-ci
      // vérifie l'étape SUIVANTE — la reprise elle-même — via la seule fermeture qui reste
      // possible, le bouton explicite. La reprise ne dépend pas de la CAUSE de la fermeture,
      // seulement du brouillon laissé dans `sessionStorage` (voir `FormulaireNouveauClient.tsx`).
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer' }));
      await utilisateur.click(await boutonNouveauClient());

      expect(await screen.findByLabelText('Nom')).toHaveValue('Rossier');
      expect(screen.getByText(/Brouillon repris de/)).toBeInTheDocument();
    });

    // Test manuel du 14.08.2026 : le testeur n'a pas pu exécuter « ouvrir une fiche, fermer sans
    // enregistrer, en ouvrir une autre et vérifier qu'aucun champ n'a gardé l'ancienne valeur »,
    // parce que le tiroir ne se fermait pas du tout (défaut du bouton « Fermer », traqué à part —
    // voir `components/ui/sheet.tsx`, hors périmètre de cet écran). Une fois la fermeture possible,
    // CE test rejoue le scénario de bout en bout via le VRAI `<Sheet>` d'`EcranListeClients` (pas
    // le harnais synthétique `EnveloppeTiroir` de `FormulaireNouveauClient.spec.tsx`, qui prouve la
    // même garantie mais à un niveau plus unitaire) : aucune valeur d'une tentative abandonnée ne
    // doit resurgir — ni en silence (elle est annoncée par le bandeau de brouillon, jamais
    // simplement réapparue), ni en se mélangeant à la saisie suivante.
    it("n'importe quelle valeur tapée dans une tentative abandonnée ne se mélange jamais à la suivante — prouvé via le vrai tiroir, fermeture par bouton comprise", async () => {
      repondreListeVide();
      const utilisateur = userEvent.setup();
      rendreEcran();

      // Première tentative, abandonnée par le bouton de fermeture explicite (le seul chemin
      // toujours autorisé, saisie en cours ou non).
      await ouvrirTiroirEtTaper(utilisateur, 'Rossier');
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer' }));
      expect(screen.queryByLabelText('Nom')).not.toBeInTheDocument();

      // Réouverture : la saisie perdue est restaurée et ANNONCÉE (issue #78), jamais silencieuse —
      // c'est la garantie « jamais de perte de saisie », pas un formulaire vierge par défaut.
      await utilisateur.click(await boutonNouveauClient());
      expect(await screen.findByLabelText('Nom')).toHaveValue('Rossier');
      expect(screen.getByText(/Brouillon repris de/)).toBeInTheDocument();

      // Rejet EXPLICITE du brouillon — repartir d'une page blanche, à la demande de l'utilisateur.
      await utilisateur.click(screen.getByRole('button', { name: 'Ignorer le brouillon' }));
      expect(screen.getByLabelText('Nom')).toHaveValue('');

      // Nouvelle saisie, distincte : ne doit contenir NI l'ancienne valeur ni une concaténation.
      await utilisateur.type(screen.getByLabelText('Nom'), 'Muller');
      expect(screen.getByLabelText('Nom')).toHaveValue('Muller');

      // Un second aller-retour fermeture/réouverture doit reprendre CETTE saisie, jamais la
      // première rejetée (« Rossier » ne doit plus jamais resurgir).
      await utilisateur.click(screen.getByRole('button', { name: 'Fermer' }));
      await utilisateur.click(await boutonNouveauClient());
      expect(await screen.findByLabelText('Nom')).toHaveValue('Muller');
      expect(screen.queryByText(/Rossier/)).not.toBeInTheDocument();
    });
  });

  describe('issue #79 — transmet numéro et nom du client créé pour la lecture qui suit', () => {
    it("passe numeroClient/nomAffiche à l'état de navigation vers la fiche, en plus de l'id", async () => {
      repondreListeVide();
      server.use(
        http.post('/api/v1/clients', () =>
          HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] }),
        ),
      );
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran();

      await ouvrirTiroirEtTaper(utilisateur, 'Rossier');
      await utilisateur.type(screen.getByLabelText('Rue et numéro'), 'Rue du Lac 8');
      await utilisateur.type(screen.getByLabelText('NPA'), '1000');
      await utilisateur.type(screen.getByLabelText('Localité'), 'Lausanne');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/clients/cl-42');
      // Verbatim terrain (client Rossier, CL-000013, issue #79) : sans ce numéro/nom transmis,
      // `EcranFicheClient` ne peut pas dire « le client a bien été créé » si la lecture qui suit
      // échoue à son tour — voir `EcranFicheClient.spec.tsx`.
      expect(routeur.state.location.state).toMatchObject({
        clientCreeNumero: 'CL-000042',
        clientCreeNom: 'Jean Rossier',
      });

      await waitFor(() =>
        expect(window.sessionStorage.getItem('dfa.brouillon.client-nouveau')).toBeNull(),
      );
    });
  });
});
