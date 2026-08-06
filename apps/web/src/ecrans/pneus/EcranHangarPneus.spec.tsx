import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

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

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pneus?site=site-1']}>
        <Routes>
          <Route path="/pneus" element={<EcranHangarPneus />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
});
