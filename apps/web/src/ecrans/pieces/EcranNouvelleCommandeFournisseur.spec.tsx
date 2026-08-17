import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseArticle } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranNouvelleCommandeFournisseur } from './EcranNouvelleCommandeFournisseur';
import type { EtatPreremplissageCommandeFournisseur } from './etat-preremplissage-commande';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/commandes-fournisseur/nouvelle']}>
        <Routes>
          <Route
            path="/pieces/commandes-fournisseur/nouvelle"
            element={<EcranNouvelleCommandeFournisseur />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Même rendu que `rendre()`, avec un état de navigation (`useLocation().state`) pré-posé — le
 *  mécanisme exact utilisé par `EcranReapprovisionnement` pour ouvrir cet écran pré-rempli. */
function rendreAvecPreremplissage(etat: EtatPreremplissageCommandeFournisseur) {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname: '/pieces/commandes-fournisseur/nouvelle', state: etat }]}
      >
        <Routes>
          <Route
            path="/pieces/commandes-fournisseur/nouvelle"
            element={<EcranNouvelleCommandeFournisseur />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Chantier « titres doublés & espacements » (contrat figé du 17.08.2026, §3) — CONTRE-EXEMPLE
 * cité nommément au contrat : « Nouvelle commande fournisseur » ne doit PAS être masqué par
 * l'onglet « Approvisionnement » ni par la vue « Commandes », malgré le mot commun « commande » —
 * aucune inclusion au sens strict (« commande » singulier ne contient pas « commandes » pluriel).
 * Vérifié en exécution plutôt que supposé : si `GabaritEcran` masquait ce titre à tort, ce serait
 * un défaut du socle à signaler, pas à contourner ici.
 */
describe('EcranNouvelleCommandeFournisseur — titre de page (PAS un doublon)', () => {
  it('le titre « Nouvelle commande fournisseur » reste visible (pas masqué par l’onglet/la vue « Commandes »)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 200 }),
      ),
    );

    rendre();

    const titre = await screen.findByRole('heading', { name: 'Nouvelle commande fournisseur' });
    expect(titre).not.toHaveClass('sr-only');
  });
});

/**
 * Preuve du défaut 2 corrigé : l'écran ne destructurait que `fournisseurs` (`[]` par défaut) —
 * un chargement lent ou un échec laissait le Select vide sans explication, l'utilisateur restait
 * bloqué sans savoir pourquoi. `isPending`/`isError` doivent maintenant être traités
 * explicitement, avec les composants d'état déjà en place ailleurs dans le dépôt.
 */
describe('EcranNouvelleCommandeFournisseur — chargement des fournisseurs', () => {
  it('affiche un état de chargement explicite tant que les fournisseurs ne sont pas arrivés (jamais un Select vide sans explication)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get(
        '/api/v1/fournisseurs',
        () => new Promise(() => {}), // ne répond jamais dans ce test : reste en chargement
      ),
    );

    rendre();

    await screen.findByRole('heading', { name: 'Nouvelle commande fournisseur' });
    // Le Select fournisseur n'est pas rendu tant que le chargement n'est pas terminé — pas de
    // combobox vide qui donnerait l'illusion « aucun fournisseur ».
    expect(screen.queryByRole('combobox', { name: 'Fournisseur' })).not.toBeInTheDocument();
    expect(document.querySelector('[role="status"]')).toBeTruthy();
  });

  it('affiche un état erreur actionnable (retry) si le chargement des fournisseurs échoue', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () =>
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

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Impossible d'afficher les fournisseurs")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Fournisseur' })).not.toBeInTheDocument();
  });

  it('affiche le Select fournisseur une fois la liste chargée avec succès', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () =>
        HttpResponse.json({
          donnees: [
            {
              id: 'fourn-1',
              nom: 'Bosch',
              statut: 'actif',
              email: null,
              telephone: null,
              delaiHabituelJours: null,
              creeLe: '2026-01-01T08:00:00.000Z',
              modifieLe: '2026-01-01T08:00:00.000Z',
            },
          ],
          curseurSuivant: null,
          limite: 200,
        }),
      ),
    );

    rendre();

    expect(await screen.findByRole('combobox', { name: 'Fournisseur' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// `schemaCreationCommandeFournisseur` (`@dfa/shared`) exige des UUID sur `siteId`/`fournisseurId`/
// `articleId` (`schemaIdentifiant = z.string().uuid()`) — à la différence des tests de lecture
// seule de ce fichier (jamais validés côté client), le test de SOUMISSION ci-dessous fait
// vraiment passer ces identifiants dans `schemaCreationCommandeFournisseur.safeParse` : des id
// courts comme `'site-1'` y échoueraient silencieusement (`validation:requis`, aucun `POST`
// envoyé) — piège vécu en écrivant ce test. D'où une session dédiée (`SESSION_UUID`) plutôt que
// `SESSION_TEST` telle quelle.
const SITE_UUID = '11111111-1111-4111-8111-111111111111';
const FOURNISSEUR_UUID = '22222222-2222-4222-8222-222222222222';
const ARTICLE_UUID = '33333333-3333-4333-8333-333333333333';
const REFERENCE_UUID = '44444444-4444-4444-8444-444444444444';

const SESSION_UUID = {
  ...SESSION_TEST,
  sites: [{ id: SITE_UUID, code: 'PRINCIPAL', nom: 'Site principal', actif: true }],
};

const ARTICLE_PREREMPLI: ReponseArticle = {
  id: ARTICLE_UUID,
  numeroArticle: 'P-000123',
  designation: 'Plaquettes de frein avant',
  marque: null,
  categorie: 'piece_mecanique',
  statut: 'actif',
  referencePrincipale: '1K0698151',
  codeBarres: null,
  prixAchatCentimes: 1200,
  prixVenteTtcCentimes: 8900,
  tauxTvaPourmille: 81,
  estEchangeStandard: false,
  montantConsigneTtcCentimes: null,
  referenceRemplacementId: null,
  references: [
    {
      id: REFERENCE_UUID,
      articleId: ARTICLE_UUID,
      type: 'fournisseur',
      reference: 'BOSCH-1234',
      fournisseurId: FOURNISSEUR_UUID,
      creeLe: '2026-01-01T08:00:00.000Z',
    },
  ],
  referencesTronquees: false,
  stocksResume: [],
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-01T08:00:00.000Z',
};

const ETAT_PREREMPLISSAGE: EtatPreremplissageCommandeFournisseur = {
  siteId: SITE_UUID,
  lignes: [
    {
      articleId: ARTICLE_UUID,
      numeroArticle: 'P-000123',
      designation: 'Plaquettes de frein avant',
      quantiteSuggereeMillieme: 4000,
    },
  ],
};

/**
 * Correctif : « le réapprovisionnement ne mène nulle part » — `EcranReapprovisionnement` ouvrait
 * bien cet écran, mais tout devait être ressaisi à la main. Ce bloc prouve le pré-remplissage
 * bout en bout : site, ligne (article + quantité suggérée) posés dès le premier rendu, prix
 * d'achat repris depuis `GET /articles/{id}` et fournisseur détecté automatiquement quand une
 * référence fournisseur unique existe sur l'article — jusqu'à la création réelle de la commande,
 * SANS aucune resaisie manuelle.
 */
describe('EcranNouvelleCommandeFournisseur — pré-remplissage depuis le réapprovisionnement', () => {
  it('pose la ligne et la quantité suggérée dès le premier rendu, sans attendre aucune requête réseau', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_UUID)),
      http.get('/api/v1/fournisseurs', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 200 }),
      ),
      http.get(`/api/v1/articles/${ARTICLE_UUID}`, () => HttpResponse.json(ARTICLE_PREREMPLI)),
    );

    rendreAvecPreremplissage(ETAT_PREREMPLISSAGE);

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();
    // `*` : champ obligatoire (`schemaQuantiteMillieme`, non optionnel dans
    // `schemaLigneCreationCommandeFournisseur`) — `<Label requis>` ajoute l'étoile au texte
    // accessible du label (`getTextContent`, `@testing-library/dom`, ne filtre pas
    // `aria-hidden`), donc au nom que `getByLabelText` doit matcher.
    expect(
      screen.getByLabelText(`${i18n.t('pieces:commandes.lignes.quantiteCommandee')}*`),
    ).toHaveValue('4');
    // DÉFAUT CORRIGÉ (n°4, test manuel du 14.08.2026) : « l'écran doit dire lequel il propose » —
    // une ligne pré-remplie depuis le réapprovisionnement porte cette aide, jamais silencieuse.
    expect(
      screen.getByText(i18n.t('pieces:commandes.nouvelle.quantiteSuggereeReapprovisionnement')),
    ).toBeInTheDocument();
  });

  it('reprend le dernier prix d’achat connu et détecte le fournisseur unique de l’article, puis crée la commande sans aucune resaisie manuelle', async () => {
    let corpsRecu: unknown;
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_UUID)),
      http.get('/api/v1/fournisseurs', () =>
        HttpResponse.json({
          donnees: [
            {
              id: FOURNISSEUR_UUID,
              nom: 'Bosch',
              statut: 'actif',
              email: null,
              telephone: null,
              delaiHabituelJours: null,
              creeLe: '2026-01-01T08:00:00.000Z',
              modifieLe: '2026-01-01T08:00:00.000Z',
            },
          ],
          curseurSuivant: null,
          limite: 200,
        }),
      ),
      http.get(`/api/v1/articles/${ARTICLE_UUID}`, () => HttpResponse.json(ARTICLE_PREREMPLI)),
      http.post('/api/v1/commandes-fournisseur', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          donnees: {
            id: 'commande-1',
            fournisseurId: FOURNISSEUR_UUID,
            siteId: SITE_UUID,
            statut: 'brouillon',
            origine: 'reapprovisionnement',
            dateCommande: '2026-08-04',
            envoyeeLe: null,
            reference: null,
            motifAnnulation: null,
            lignes: [],
            lignesTronquees: false,
            creeLe: '2026-08-04T08:00:00.000Z',
            modifieLe: '2026-08-04T08:00:00.000Z',
          },
          avertissements: [],
        });
      }),
    );

    rendreAvecPreremplissage(ETAT_PREREMPLISSAGE);

    // Le prix d'achat repris (`ChampMontant` resynchronise depuis `valeurCentimes`) s'affiche
    // sans aucune saisie de l'utilisateur.
    await waitFor(() =>
      expect(screen.getByLabelText(i18n.t('pieces:commandes.lignes.prixAchatAttendu'))).toHaveValue(
        '12.00',
      ),
    );
    // Le fournisseur détecté peut committer un rendu APRÈS le prix (deux requêtes réseau
    // distinctes, `GET /articles/{id}` et `GET /fournisseurs`, résolues indépendamment) — attendre
    // explicitement son affichage avant de soumettre, sinon le clic peut arriver avant que
    // `fournisseurId` ne soit posé et échouer sur « Ce champ est obligatoire ».
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Fournisseur' })).toHaveTextContent('Bosch'),
    );

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('pieces:commandes.actions.creer') }),
    );

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      fournisseurId: FOURNISSEUR_UUID,
      siteId: SITE_UUID,
      origine: 'reapprovisionnement',
      lignes: [
        {
          articleId: ARTICLE_UUID,
          quantiteCommandeeMillieme: 4000,
          prixAchatAttenduCentimes: 1200,
        },
      ],
    });
  });

  it('reste pleinement utilisable SANS pré-remplissage (usage direct de l’écran, non-régression)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/fournisseurs', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 200 }),
      ),
    );

    rendre();

    expect(
      await screen.findByRole('heading', { name: 'Nouvelle commande fournisseur' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('pieces:commandes.nouvelle.choisirSiteDabord')),
    ).toBeInTheDocument();
    expect(screen.queryByText('Plaquettes de frein avant')).not.toBeInTheDocument();
  });
});
