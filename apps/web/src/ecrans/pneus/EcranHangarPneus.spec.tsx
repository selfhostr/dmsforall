import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseDepotPneus } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranHangarPneus } from './EcranHangarPneus';

// Radix Select appelle `hasPointerCapture`/`scrollIntoView`, absents de jsdom — même stub que
// `EcranListeFournisseurs.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const DEPOT: ReponseDepotPneus = {
  id: 'depot-1',
  vehiculeId: 'vehicule-1',
  siteId: 'site-1',
  saison: 'hiver',
  statut: 'en_depot',
  codeCase: 'Rack 3',
  dimension: '205/55 R16',
  etat: null,
  entreLe: '2026-01-01T08:00:00.000Z',
  dernierMouvementLe: '2026-01-01T08:00:00.000Z',
  motifSortie: null,
  ligneOrDernierChangementId: null,
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-01T08:00:00.000Z',
};

const DEPOT_2: ReponseDepotPneus = {
  ...DEPOT,
  id: 'depot-2',
  vehiculeId: 'vehicule-2',
  codeCase: 'Rack 5',
};

/** Fixture reprise de l'ancien `EcranJeuxARelancer.spec.tsx` (écran fusionné dans celui-ci,
 *  onglet « À relancer »). */
const DEPOT_A_RELANCER: ReponseDepotPneus = {
  id: 'depot-7',
  vehiculeId: 'vehicule-7',
  siteId: 'site-1',
  saison: 'ete',
  statut: 'a_relancer',
  codeCase: 'Rack 7',
  dimension: '195/65 R15',
  etat: null,
  entreLe: '2023-01-01T08:00:00.000Z',
  dernierMouvementLe: '2023-01-01T08:00:00.000Z',
  motifSortie: null,
  ligneOrDernierChangementId: null,
  creeLe: '2023-01-01T08:00:00.000Z',
  modifieLe: '2023-01-01T08:00:00.000Z',
};

const ERREUR_INTERNE_500 = {
  type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
  title: 'Erreur interne',
  status: 500,
  code: 'ERREUR_INTERNE',
  instance: 'req-1',
} as const;

function pageDe(donnees: readonly ReponseDepotPneus[]): PageCurseur<ReponseDepotPneus> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre(entree = '/pneus?site=site-1') {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entree]}>
        <Routes>
          <Route path="/pneus" element={<EcranHangarPneus />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Le hangar fusionné (Lot D) interroge désormais AUSSI `GET /depots-pneus/a-relancer` dès le
// montage (onglet « À relancer », voir la note de tête d'`EcranHangarPneus.tsx`) — même quand le
// test ne s'intéresse qu'à l'onglet « Dans le hangar ». Réponse vide par défaut pour ne pas faire
// échouer les tests existants sur une requête non mockée (`onUnhandledRequest: 'error'`, voir
// `src/test/setup.ts`) ; les tests dédiés à l'onglet « À relancer » ci-dessous la RECOUVRENT avec
// leur propre `server.use(...)`, enregistré après celui-ci et donc prioritaire (MSW v2 : dernier
// handler enregistré gagne pour un même chemin).
beforeEach(() => {
  server.use(http.get('/api/v1/depots-pneus/a-relancer', () => HttpResponse.json(pageDe([]))));
});

describe('EcranHangarPneus', () => {
  it('affiche nominalement les jeux du hangar', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
    );

    rendre();

    expect(await screen.findByText('Rack 3')).toBeInTheDocument();
    expect(screen.getByText('Hiver')).toBeInTheDocument();
    expect(screen.getByText('205/55 R16')).toBeInTheDocument();
    expect(screen.getByText('En dépôt')).toBeInTheDocument();
  });

  it('hangar vide : invite premier usage, pas une erreur', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(
      await screen.findByText("Aucun jeu de pneus n'est encore entré dans ce hangar."),
    ).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/sites/site-1/hangar-pneus', () =>
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

    expect(await screen.findByText("Impossible d'afficher le hangar")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('changement de saison : ouvre le dialogue, confirme, invalide le hangar', async () => {
    const utilisateur = userEvent.setup();
    let appelsChangerSaison = 0;

    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
      http.post('/api/v1/depots-pneus/depot-1/changer-saison', () => {
        appelsChangerSaison += 1;
        return HttpResponse.json({ ...DEPOT, statut: 'monte' });
      }),
    );

    rendre();

    await screen.findByText('Rack 3');
    await utilisateur.click(screen.getByRole('button', { name: 'Changer de saison' }));

    const dialogue = await screen.findByRole('dialog');
    expect(
      within(dialogue).getByRole('heading', { name: 'Changer de saison' }),
    ).toBeInTheDocument();

    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Changer de saison' }));

    await waitFor(() => expect(appelsChangerSaison).toBe(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('masquage selon les droits : un rôle sans écriture ne voit aucune action de gestion', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'comptable' },
        }),
      ),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
    );

    rendre();

    await screen.findByText('Rack 3');
    expect(screen.queryByRole('button', { name: 'Nouveau dépôt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Changer de saison' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Déplacer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sortir' })).not.toBeInTheDocument();
    // La lecture reste ouverte à `comptable` (ROLES_PNEUS_DEPOT_LECTURE) : le lien de
    // consultation, lui, reste visible.
    expect(screen.getByRole('link', { name: 'Voir le véhicule' })).toBeInTheDocument();
  });

  /**
   * Défaut corrigé : l'erreur de mutation n'était jamais réinitialisée à la réouverture du
   * dialogue — un échec sur le jeu A restait affiché à l'ouverture pour le jeu B. Deux jeux
   * distincts (`DEPOT`/Rack 3, `DEPOT_2`/Rack 5) : ouverture pour A → échec → fermeture →
   * ouverture pour B → l'erreur du jeu A ne doit plus apparaître (`mutation.reset()` sur `[depot]`).
   */
  it(
    '« Changer de saison » : un échec sur un jeu ne reste pas affiché à la réouverture du ' +
      'dialogue pour un AUTRE jeu',
    async () => {
      const utilisateur = userEvent.setup();
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/sites/site-1/hangar-pneus', () =>
          HttpResponse.json(pageDe([DEPOT, DEPOT_2])),
        ),
        http.post('/api/v1/depots-pneus/depot-1/changer-saison', () =>
          HttpResponse.json(ERREUR_INTERNE_500, {
            status: 500,
            headers: { 'content-type': 'application/problem+json' },
          }),
        ),
      );

      rendre();

      await screen.findByText('Rack 3');
      await screen.findByText('Rack 5');

      // Jeu A (Rack 3, premier de la grille) : ouvre, confirme, échoue.
      await utilisateur.click(screen.getAllByRole('button', { name: 'Changer de saison' })[0]!);
      const dialogueA = await screen.findByRole('dialog');
      await utilisateur.click(within(dialogueA).getByRole('button', { name: 'Changer de saison' }));
      expect(await within(dialogueA).findByRole('alert')).toBeInTheDocument();

      // Ferme, puis rouvre pour le jeu B (Rack 5, second de la grille).
      await utilisateur.click(within(dialogueA).getByRole('button', { name: 'Annuler' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      await utilisateur.click(screen.getAllByRole('button', { name: 'Changer de saison' })[1]!);
      const dialogueB = await screen.findByRole('dialog');
      expect(within(dialogueB).getByText(/Rack 5/)).toBeInTheDocument();
      expect(within(dialogueB).queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it(
    '« Sortir » : un échec sur un jeu ne reste pas affiché à la réouverture du dialogue pour un ' +
      'AUTRE jeu',
    async () => {
      const utilisateur = userEvent.setup();
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/sites/site-1/hangar-pneus', () =>
          HttpResponse.json(pageDe([DEPOT, DEPOT_2])),
        ),
        http.post('/api/v1/depots-pneus/depot-1/sortir', () =>
          HttpResponse.json(ERREUR_INTERNE_500, {
            status: 500,
            headers: { 'content-type': 'application/problem+json' },
          }),
        ),
      );

      rendre();

      await screen.findByText('Rack 3');
      await screen.findByText('Rack 5');

      // Jeu A (Rack 3) : ouvre, choisit un motif, confirme, échoue.
      await utilisateur.click(screen.getAllByRole('button', { name: 'Sortir' })[0]!);
      const dialogueA = await screen.findByRole('dialog');
      await utilisateur.click(within(dialogueA).getByRole('combobox', { name: 'Motif de sortie' }));
      await utilisateur.click(await screen.findByRole('option', { name: 'Rendu au client' }));
      await utilisateur.click(within(dialogueA).getByRole('button', { name: 'Sortir' }));
      expect(await within(dialogueA).findByRole('alert')).toBeInTheDocument();

      // Ferme, puis rouvre pour le jeu B (Rack 5).
      await utilisateur.click(within(dialogueA).getByRole('button', { name: 'Annuler' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      await utilisateur.click(screen.getAllByRole('button', { name: 'Sortir' })[1]!);
      const dialogueB = await screen.findByRole('dialog');
      expect(within(dialogueB).getByText(/Rack 5/)).toBeInTheDocument();
      expect(within(dialogueB).queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  /**
   * Défaut corrigé (rapport de test du 06.08.2026, n°2) : aucun bouton n'exposait
   * `POST /depots-pneus/{id}/deplacer`, pourtant livré côté API — le geste le plus courant d'un
   * hangar (déplacer un jeu d'une case à l'autre) était introuvable. Le champ est pré-rempli avec
   * le repère ACTUEL (pas vide) : le geste habituel est de le CORRIGER.
   */
  it('déplacer : pré-rempli avec le repère actuel, confirme, invalide le hangar', async () => {
    const utilisateur = userEvent.setup();
    let corpsRecu: unknown;

    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
      http.post('/api/v1/depots-pneus/depot-1/deplacer', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ ...DEPOT, codeCase: 'B9' });
      }),
    );

    rendre();

    await screen.findByText('Rack 3');
    await utilisateur.click(screen.getByRole('button', { name: 'Déplacer' }));

    const dialogue = await screen.findByRole('dialog');
    expect(within(dialogue).getByRole('heading', { name: 'Déplacer ce jeu' })).toBeInTheDocument();
    const champCodeCase = within(dialogue).getByLabelText('Nouveau repère');
    expect(champCodeCase).toHaveValue('Rack 3');

    await utilisateur.clear(champCodeCase);
    await utilisateur.type(champCodeCase, 'B9');
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Déplacer' }));

    await waitFor(() => expect(corpsRecu).toEqual({ codeCase: 'B9' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  /**
   * Défaut corrigé (rapport de test du 06.08.2026, n°1) : la recherche par nom de client ne
   * trouvait jamais rien — `listerVehicules({ detenteurId: ... })` envoyait la requête SANS ce
   * filtre (voir le commentaire de tête de `useRechercheHangarPneus.ts`). Reproduit ici la chaîne
   * complète : `GET /recherche` (client) -> `GET /vehicules?detenteurId=` (son véhicule) ->
   * `GET /vehicules/{id}/depots-pneus` (son jeu actif).
   */
  it('recherche par nom de client : trouve un jeu rattaché à un véhicule du client', async () => {
    const utilisateur = userEvent.setup();

    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([]))),
      http.get('/api/v1/recherche', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        if (q !== 'Meier') {
          return HttpResponse.json({ resultats: [], plaqueInterchangeable: false });
        }
        return HttpResponse.json({
          resultats: [
            {
              type: 'client',
              id: 'client-1',
              score: 0.5,
              correspondance: { champ: 'nom', valeur: 'Meier Urs', historique: false },
              resume: { nom: 'Meier Urs' },
            },
          ],
          plaqueInterchangeable: false,
        });
      }),
      http.get('/api/v1/vehicules', ({ request }) => {
        const parametres = new URL(request.url).searchParams;
        // La preuve du défaut : sans le correctif, ce paramètre n'était jamais envoyé.
        expect(parametres.get('detenteurId')).toBe('client-1');
        return HttpResponse.json({
          donnees: [
            {
              id: 'vehicule-9',
              plaque: 'VS 123456',
              canton: 'VS',
              designation: 'Volkswagen Golf',
              vin: null,
              premiereMiseEnCirculationLe: null,
              identificationIncomplete: false,
              emplacementLibre: null,
            },
          ],
          curseurSuivant: null,
          limite: 5,
        });
      }),
      http.get('/api/v1/vehicules/vehicule-9/depots-pneus', () =>
        HttpResponse.json(
          pageDe([{ ...DEPOT, id: 'depot-9', vehiculeId: 'vehicule-9', codeCase: 'B3' }]),
        ),
      ),
    );

    rendre();

    const champRecherche = await screen.findByLabelText('Rechercher par plaque ou nom client');
    await utilisateur.type(champRecherche, 'Meier');

    expect(await screen.findByText('B3', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.getByText('Meier Urs')).toBeInTheDocument();
    expect(screen.getByText(/Volkswagen Golf/)).toBeInTheDocument();
  });

  /**
   * Fusion Lot D (`docs/refonte-navigation.md`) : `EcranJeuxARelancer` est supprimé, sa liste
   * devient l'onglet « À relancer » de cet écran. Les quatre tests ci-dessous reprennent
   * littéralement la couverture de l'ancien `EcranJeuxARelancer.spec.tsx` (mêmes assertions,
   * aucune affaiblie), adaptée pour passer par le clic d'onglet plutôt que par une route dédiée.
   */
  describe('onglet « À relancer » (fusion Lot D)', () => {
    it(
      "atteignable SANS site choisi — capacité tenant entier de l'ancien écran préservée " +
        "(contrairement à l'onglet « Dans le hangar », bloqué sans site)",
      async () => {
        const utilisateur = userEvent.setup();
        server.use(
          http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
          http.get('/api/v1/depots-pneus/a-relancer', ({ request }) => {
            // Preuve que la vue est bien tenant entier : aucun `siteId` envoyé.
            expect(new URL(request.url).searchParams.get('siteId')).toBeNull();
            return HttpResponse.json(pageDe([DEPOT_A_RELANCER]));
          }),
        );

        // Pas de `?site=` dans l'URL : l'onglet « Dans le hangar » (par défaut) doit réclamer un
        // site, l'onglet « À relancer » non.
        rendre('/pneus');

        expect(await screen.findByText('Choisissez un site')).toBeInTheDocument();

        await utilisateur.click(screen.getByRole('tab', { name: 'À relancer' }));

        expect(await screen.findByText('Rack 7')).toBeInTheDocument();
        expect(screen.queryByText('Choisissez un site')).not.toBeInTheDocument();
      },
    );

    it('état vide : aucun jeu à relancer', async () => {
      const utilisateur = userEvent.setup();
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([]))),
        http.get('/api/v1/depots-pneus/a-relancer', () => HttpResponse.json(pageDe([]))),
      );

      rendre();

      await utilisateur.click(await screen.findByRole('tab', { name: 'À relancer' }));

      expect(await screen.findByText('Aucun jeu à relancer.')).toBeInTheDocument();
    });

    it(
      'ne propose pas « Changer de saison » — défaut corrigé : cette liste ne contient QUE des ' +
        'dépôts au statut `a_relancer`, un statut où le serveur rejette systématiquement ce geste ' +
        '(autorisé seulement `en_depot`/`monte`, même condition que `CarteJeuPneu`) — « Sortir » ' +
        'reste bien proposé, lui, à un rôle habilité (`chef_atelier`, session de test par défaut)',
      async () => {
        const utilisateur = userEvent.setup();
        server.use(
          http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
          http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([]))),
          http.get('/api/v1/depots-pneus/a-relancer', () =>
            HttpResponse.json(pageDe([DEPOT_A_RELANCER])),
          ),
        );

        rendre();

        await utilisateur.click(await screen.findByRole('tab', { name: 'À relancer' }));

        expect(await screen.findByRole('button', { name: 'Sortir' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Changer de saison' })).not.toBeInTheDocument();
      },
    );

    it("erreur : message actionnable avec retry, propre à l'onglet (le plan reste consultable)", async () => {
      const utilisateur = userEvent.setup();
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
        http.get('/api/v1/depots-pneus/a-relancer', () =>
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

      await screen.findByText('Rack 3');
      await utilisateur.click(screen.getByRole('tab', { name: 'À relancer' }));

      expect(
        await screen.findByText("Impossible d'afficher les jeux à relancer"),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    });
  });
});
