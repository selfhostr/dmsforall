import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponsePointage } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranPointage } from './EcranPointage';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function pageVide(): PageCurseur<ReponsePointage> {
  return pagePointages([]);
}

function rendre(entree = '/pointage') {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entree]}>
        <Routes>
          <Route path="/pointage" element={<EcranPointage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Écran fusionné (Lot D) : ces tests couvrent l'ASSEMBLAGE (gate de site unique, présence/absence
 * de l'onglet Équipe selon le rôle, bascule entre vues). Le CONTENU de chaque vue (colonnes,
 * états vide/erreur, format de la cible…) est testé isolément dans `VueJournalPointage.spec.tsx`
 * et `VueEquipePointage.spec.tsx` — inutile de le reproduire ici, ce serait le même test masqué
 * derrière un montage plus lourd.
 */
describe('EcranPointage', () => {
  it(
    'multi-site : le site principal est le défaut (jamais « Choisissez un site »), le filtre de ' +
      'site commun est affiché sans « Tous » (les vues travaillent sur un site) et le choix ' +
      "bascule les requêtes sur l'autre site",
    async () => {
      const sitesVus: (string | null)[] = [];
      server.use(
        http.get('/api/v1/auth/moi', () =>
          HttpResponse.json({
            ...SESSION_TEST,
            sitePrincipalId: 'site-2',
            sites: [
              { id: 'site-1', code: 'P', codeCourt: 'P', nom: 'Site principal', actif: true },
              { id: 'site-2', code: 'S', codeCourt: 'S', nom: 'Site secondaire', actif: true },
            ],
          }),
        ),
        http.get('/api/v1/pointages', ({ request }) => {
          sitesVus.push(new URL(request.url).searchParams.get('siteId'));
          return HttpResponse.json(pageVide());
        }),
      );

      rendre();

      expect(await screen.findByTestId('filtre-site')).toBeInTheDocument();
      expect(screen.queryByText('Choisissez un site')).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Tous les sites' })).not.toBeInTheDocument();
      await waitFor(() => expect(sitesVus).toContain('site-2'));
      expect(sitesVus).not.toContain('site-1');
    },
  );

  it(
    "n'ajoute aucun second jeu d'onglets Journal / Équipe (déjà dans la barre du domaine) et " +
      'atterrit par défaut sur la vue Journal',
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pageVide())),
      );

      rendre();

      expect(
        await screen.findByText('Aucun pointage enregistré sur cette période.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Équipe' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Clôturer la période' })).not.toBeInTheDocument();
    },
  );

  it('`?vue=equipe` affiche la vue Équipe (geste de clôture de période)', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pageVide())),
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre('/pointage?vue=equipe');

    expect(await screen.findByRole('button', { name: 'Clôturer la période' })).toBeInTheDocument();
  });

  it(
    "n'affiche AUCUN onglet global pour un rôle sans vue équipe (technicien) — l'onglet " +
      '« Équipe » est ABSENT du DOM, jamais grisé : un technicien ne doit même pas savoir que ' +
      'cette vue existe. La bascule interne jour/semaine de la vue Journal, elle, reste intacte : ' +
      "ce n'est pas une capacité liée à l'encadrement.",
    async () => {
      server.use(
        http.get('/api/v1/auth/moi', () =>
          HttpResponse.json({
            ...SESSION_TEST,
            utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
          }),
        ),
        http.get('/api/v1/pointages', () => HttpResponse.json(pageVide())),
      );

      rendre();

      expect(
        await screen.findByText('Aucun pointage enregistré sur cette période.'),
      ).toBeInTheDocument();
      // Pas d'onglet global Journal/Équipe : seule la bascule interne jour/semaine subsiste.
      expect(screen.queryByRole('tab', { name: 'Journal' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tab', { name: 'Équipe' })).not.toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Jour' })).toBeInTheDocument();
      expect(screen.queryByText('Équipe')).not.toBeInTheDocument();
    },
  );
});
