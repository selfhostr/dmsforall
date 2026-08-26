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
      await screen.findByText("Aucun jeu de pneus n'est encore entré ici."),
    ).toBeInTheDocument();
  });

  // Chantier « titres doublés & espacements » (17.08.2026, GabaritEcran) : le titre d'écran
  // (« Dépôt pneus ») répète mot pour mot le libellé de l'onglet Atelier actif — la détection
  // automatique de `GabaritEcran` doit donc garder le h1 dans le DOM (lecteur d'écran) mais masqué
  // visuellement, jamais retiré. La classe `sr-only` est la preuve fiable ici — `toBeVisible()`
  // (jest-dom) ne détecte pas la technique `position: absolute; clip: …` sans feuille de style
  // chargée (jsdom, ces tests) — même mesure que `EcranListeVehicules.spec.tsx`. Rendu à `/pneus`,
  // la VRAIE route de production (`chemins.pneus.hangar`, `motifs: ['/pneus']` dans
  // `navigation-modele.ts`) : un montage à `/` ne prouverait rien sur la détection, qui dépend de
  // la correspondance route → onglet.
  //
  // RE-QUÊTE À CHAQUE ITÉRATION (pas de référence DOM capturée une fois pour toutes) — mesuré :
  // cet écran ne passe ni `sousTitre` ni `actions` à `GabaritEcran`, donc tant que le titre reste
  // visible (avant que la session/le rôle ne soit résolu, `estTitreDoublonNavigation` n'a pas encore
  // de libellé d'onglet à comparer) le gabarit rend la ligne d'en-tête complète ; dès que le doublon
  // est détecté ET qu'aucun sous-titre/action n'est présent, `GabaritEcran` bascule sur sa branche
  // anti-trou (§4 du contrat), qui a une profondeur JSX différente — React démonte alors l'ancien
  // `h1` et en remonte un nouveau plutôt que de muter en place. Un `h1` capturé une seule fois avant
  // ce basculement reste un nœud DÉTACHÉ dont la classe ne bougera jamais (vérifié en isolant le
  // rendu : `document.querySelectorAll('h1')` ne compte jamais plus d'UN SEUL `h1` dans le DOM à un
  // instant donné — ce n'est pas un doublon de titre, seulement une identité de nœud qui change).
  // `waitFor` avec une requête `getByRole` FRAÎCHE à chaque tour contourne cette instabilité sans
  // rien affaiblir : la classe `sr-only` doit toujours finir par apparaître sur LE `h1` réellement
  // présent à l'écran. Signalé au socle (`composants/motifs/GabaritEcran.tsx`, hors périmètre
  // d'écriture de cet agent) : la bascule entre les deux formes de rendu du gabarit pourrait
  // conserver la même profondeur de conteneur pour éviter ce remontage.
  it("garde un h1 accessible « Dépôt pneus » dans le DOM, masqué via `sr-only` (doublon avec l'onglet actif)", async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
    );

    rendre();

    await screen.findByRole('heading', { level: 1, name: 'Dépôt pneus' });
    await waitFor(() => {
      const titre = screen.getByRole('heading', { level: 1, name: 'Dépôt pneus' });
      expect(titre.className).toMatch(/\bsr-only\b/);
    });
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
   * Défaut corrigé (parcours navigateur, 10.08.2026) : un technicien voyait le bouton « Sortir »
   * bien que `pneus.depot.sortir` (`apps/api/src/auth/matrice-droits.ts`, `SORTIE_PNEUS`) ne lui
   * soit jamais accordé — un seul booléen `peutGererDepotPneus` gouvernait auparavant les trois
   * gestes indifféremment. Il cliquait, remplissait le dialogue (motif obligatoire), soumettait, et
   * recevait un `403` honnête mais évitable : un geste offert puis repris, ce que ce dépôt s'interdit
   * ailleurs (`EcranFicheFacture.tsx` : « un rôle sans droit ne voit pas un bouton grisé, il ne voit
   * pas de bouton »). Matrice rôle × action : `technicien`/`magasinier` ont `creer`/`changer_saison`
   * (donc « Changer de saison » ET « Déplacer », ce dernier partageant le même droit serveur, voir
   * `depot-pneus.controller.ts`) mais PAS `sortir` ; `receptionnaire`/`chef_atelier`/`direction`/
   * `admin` ont les quatre.
   */
  it('matrice rôle × action : un technicien ne voit pas « Sortir », un réceptionnaire le voit', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
        }),
      ),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
    );

    rendre();

    await screen.findByText('Rack 3');
    expect(screen.getByRole('button', { name: 'Changer de saison' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déplacer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sortir' })).not.toBeInTheDocument();
    // La création reste un geste d'entrée physique (`pneus.depot.creer`, même périmètre que
    // `changer_saison`) : accordée au technicien.
    expect(screen.getByRole('button', { name: 'Nouveau dépôt' })).toBeInTheDocument();
  });

  it('matrice rôle × action : un réceptionnaire voit les quatre actions, dont « Sortir »', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'receptionnaire' },
        }),
      ),
      http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
    );

    rendre();

    await screen.findByText('Rack 3');
    expect(screen.getByRole('button', { name: 'Nouveau dépôt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Changer de saison' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Déplacer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sortir' })).toBeInTheDocument();
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

      expect(
        await screen.findByText("Aucun jeu n'est en retard de mouvement."),
      ).toBeInTheDocument();
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

    /**
     * RÉGRESSION CORRIGÉE (chantier d'unification inter-écrans, 25.08.2026) : cet onglet
     * réimplémentait son propre sélecteur de site à la main, hors `BarreFiltres` — sans bouton
     * « Effacer les filtres », contrairement à tous les autres écrans à liste du produit. Migré
     * sur `BarreFiltres` : `q` porte désormais un filtre repère local (même mécanisme que l'onglet
     * « Actifs »), effaçable en un geste.
     */
    it(
      'filtre localement par repère (`codeCase`) et « Effacer les filtres » le vide, sans perdre ' +
        'les jeux qui ne correspondaient plus',
      async () => {
        const utilisateur = userEvent.setup();
        const AUTRE_DEPOT_A_RELANCER: ReponseDepotPneus = {
          ...DEPOT_A_RELANCER,
          id: 'depot-8',
          vehiculeId: 'vehicule-8',
          codeCase: 'Rack 12',
        };
        server.use(
          http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
          http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([]))),
          http.get('/api/v1/depots-pneus/a-relancer', () =>
            HttpResponse.json(pageDe([DEPOT_A_RELANCER, AUTRE_DEPOT_A_RELANCER])),
          ),
        );

        rendre();

        await utilisateur.click(await screen.findByRole('tab', { name: 'À relancer' }));

        expect(await screen.findByText('Rack 7')).toBeInTheDocument();
        expect(screen.getByText('Rack 12')).toBeInTheDocument();

        const boutonEffacer = screen.getByRole('button', { name: 'Effacer les filtres' });
        expect(boutonEffacer).toBeDisabled();

        await utilisateur.type(screen.getByRole('searchbox'), 'Rack 7');

        expect(screen.getByText('Rack 7')).toBeInTheDocument();
        expect(screen.queryByText('Rack 12')).not.toBeInTheDocument();
        expect(boutonEffacer).toBeEnabled();

        await utilisateur.click(boutonEffacer);

        expect(await screen.findByText('Rack 12')).toBeInTheDocument();
        expect(screen.getByText('Rack 7')).toBeInTheDocument();
        expect(boutonEffacer).toBeDisabled();
      },
    );
  });

  /**
   * Défaut corrigé : le lien « Voir dans le hangar à pneus » de la fiche véhicule menait à `/pneus`
   * sans jamais désigner LEQUEL des jeux du site regarder — le magasinier devait refaire une
   * recherche visuelle. `?depot=<id>` (même mécanique que `?site=`/`?onglet=`, voir le commentaire
   * de tête du fichier) met la carte correspondante en évidence : défilement + focus programmatique
   * (repérable au clavier/lecteur d'écran, pas seulement par la couleur) + badge textuel visible.
   */
  describe('mise en évidence par `?depot=`', () => {
    it('surligne la carte du jeu ciblé : focus, badge textuel, sans filtrer le reste du plan', async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/sites/site-1/hangar-pneus', () =>
          HttpResponse.json(pageDe([DEPOT, DEPOT_2])),
        ),
      );

      rendre('/pneus?site=site-1&depot=depot-2');

      // La carte visée prend le focus (repérable au clavier/lecteur d'écran, pas seulement par un
      // contour de couleur) : preuve la plus forte que la mise en évidence est ACCESSIBLE.
      const carteCiblee = await screen.findByRole('generic', { name: /Rack 5/ });
      await waitFor(() => expect(carteCiblee).toHaveFocus());

      // Badge textuel — la couleur seule ne porte jamais l'information dans ce dépôt.
      expect(within(carteCiblee).getByText('Jeu recherché')).toBeInTheDocument();

      // Le reste du plan reste VISIBLE autour (pas un filtre qui masquerait le contexte) : le
      // magasinier doit pouvoir voir les cases voisines, qui elles n'ont PAS le badge.
      const carteVoisine = screen.getByText('Rack 3').closest('.rounded-lg') as HTMLElement;
      expect(within(carteVoisine).queryByText('Jeu recherché')).not.toBeInTheDocument();
    });

    it(
      'dépôt absent (déplacé, sorti, ou pas sur ce site) : aucune mise en évidence fabriquée, ' +
        'le hangar reste utilisable, message honnête affiché',
      async () => {
        server.use(
          http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
          http.get('/api/v1/sites/site-1/hangar-pneus', () => HttpResponse.json(pageDe([DEPOT]))),
        );

        rendre('/pneus?site=site-1&depot=depot-introuvable');

        // Le hangar s'affiche NORMALEMENT — aucun plantage, aucun état vide fabriqué.
        expect(await screen.findByText('Rack 3')).toBeInTheDocument();
        // Mention honnête : ni fausse mise en évidence, ni silence.
        expect(await screen.findByText('Jeu introuvable ici')).toBeInTheDocument();
        expect(screen.queryByText('Jeu recherché')).not.toBeInTheDocument();
      },
    );
  });
});
