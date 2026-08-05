import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { LigneReapprovisionnement } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranReapprovisionnement } from './EcranReapprovisionnement';

const CHEMIN = '/api/v1/stock/reapprovisionnement';

const LIGNES: LigneReapprovisionnement[] = [
  {
    articleId: 'art-1',
    numeroArticle: 'P-000123',
    designation: 'Plaquettes de frein avant',
    siteId: 'site-1',
    quantiteDisponibleMillieme: 1000,
    stockMinimumMillieme: 5000,
    ecartMillieme: 4000,
    quantiteCommandeStandardMillieme: null,
  },
  {
    articleId: 'art-2',
    numeroArticle: 'P-000456',
    designation: 'Filtre à huile',
    siteId: 'site-1',
    quantiteDisponibleMillieme: 0,
    stockMinimumMillieme: 3000,
    ecartMillieme: 3000,
    quantiteCommandeStandardMillieme: 6000,
  },
];

/** Écran cible de test : capture `useLocation().state`, la seule façon d'observer un état de
 *  navigation React Router sans monter le véritable `EcranNouvelleCommandeFournisseur` (qui
 *  porterait ses propres appels réseau, hors sujet ici — ce test prouve le CÂBLAGE, pas l'écran
 *  cible, déjà couvert par `EcranNouvelleCommandeFournisseur.spec.tsx`). */
function EcranCibleTest() {
  const location = useLocation();
  return <pre data-testid="etat-navigation">{JSON.stringify(location.state)}</pre>;
}

function connecterSession(role: (typeof SESSION_TEST)['utilisateur']['role'] = 'chef_atelier') {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

function rendre(routeInitiale = '/pieces/reapprovisionnement?site=site-1') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <Routes>
          <Route path="/pieces/reapprovisionnement" element={<EcranReapprovisionnement />} />
          <Route path="/pieces/commandes-fournisseur/nouvelle" element={<EcranCibleTest />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranReapprovisionnement — états de base', () => {
  it('demande un site tant qu’aucun n’est sélectionné', async () => {
    connecterSession();
    rendre('/pieces/reapprovisionnement');

    expect(await screen.findByText(i18n.t('pieces:siteRequis.titre'))).toBeInTheDocument();
  });

  it('affiche un état d’erreur actionnable sur une panne serveur', async () => {
    connecterSession();
    server.use(
      http.get(CHEMIN, () =>
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

    expect(
      await screen.findByText(i18n.t('pieces:stock.reapprovisionnement.erreur.titre')),
    ).toBeInTheDocument();
  });

  it('affiche l’état vide quand aucun article ne manque', async () => {
    connecterSession();
    server.use(
      http.get(CHEMIN, () => HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 })),
    );

    rendre();

    expect(
      await screen.findByText(i18n.t('pieces:stock.reapprovisionnement.vide')),
    ).toBeInTheDocument();
  });

  it('affiche les lignes reçues', async () => {
    connecterSession();
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(await screen.findByText('Plaquettes de frein avant')).toBeInTheDocument();
    expect(screen.getByText('Filtre à huile')).toBeInTheDocument();
  });
});

/**
 * Correctif : « le réapprovisionnement ne mène nulle part » (commentaire de tête, avant ce
 * correctif) — le magasinier voyait quoi commander mais devait tout ressaisir dans
 * `EcranNouvelleCommandeFournisseur`. Ce bloc prouve le câblage : sélection de lignes, action
 * « Commander », navigation avec l'état attendu.
 */
describe('EcranReapprovisionnement — sélection et passage vers la création de commande', () => {
  it('un rôle habilité à créer une commande (chef_atelier) voit une case à cocher par ligne', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    await screen.findByText('Plaquettes de frein avant');
    expect(
      screen.getByRole('checkbox', {
        name: i18n.t('pieces:stock.reapprovisionnement.selection.aria', {
          designation: 'Plaquettes de frein avant',
        }),
      }),
    ).toBeInTheDocument();
  });

  it('un rôle sans droit de créer une commande (technicien) ne voit aucune case à cocher ni bouton « Commander »', async () => {
    connecterSession('technicien');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    await screen.findByText('Plaquettes de frein avant');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: i18n.t('pieces:stock.reapprovisionnement.actions.commander'),
      }),
    ).not.toBeInTheDocument();
  });

  it('sélectionner des lignes puis cliquer « Commander » navigue vers la création pré-remplie (site + articles + quantités suggérées)', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    await screen.findByText('Plaquettes de frein avant');
    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('checkbox', {
        name: i18n.t('pieces:stock.reapprovisionnement.selection.aria', {
          designation: 'Plaquettes de frein avant',
        }),
      }),
    );
    await utilisateur.click(
      screen.getByRole('checkbox', {
        name: i18n.t('pieces:stock.reapprovisionnement.selection.aria', {
          designation: 'Filtre à huile',
        }),
      }),
    );

    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.reapprovisionnement.actions.commander'),
      }),
    );

    const etatBrut = await screen.findByTestId('etat-navigation');
    const etat = JSON.parse(etatBrut.textContent ?? 'null');
    expect(etat).toEqual({
      siteId: 'site-1',
      lignes: [
        {
          articleId: 'art-1',
          numeroArticle: 'P-000123',
          designation: 'Plaquettes de frein avant',
          // Pas de `quantiteCommandeStandardMillieme` pour cette ligne : repli sur `ecartMillieme`.
          quantiteSuggereeMillieme: 4000,
        },
        {
          articleId: 'art-2',
          numeroArticle: 'P-000456',
          designation: 'Filtre à huile',
          // `quantiteCommandeStandardMillieme` renseignée : priorité sur `ecartMillieme`.
          quantiteSuggereeMillieme: 6000,
        },
      ],
    });
  });
});
