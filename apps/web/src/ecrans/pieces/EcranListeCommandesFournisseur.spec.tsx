import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponseCommandeFournisseur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranListeCommandesFournisseur } from './EcranListeCommandesFournisseur';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const COMMANDE: ReponseCommandeFournisseur = {
  id: 'cmd-1',
  fournisseurId: 'fourn-1',
  siteId: 'site-1',
  statut: 'envoyee',
  origine: 'manuelle',
  dateCommande: '2026-02-01',
  envoyeeLe: '2026-02-01T09:00:00.000Z',
  reference: 'BOSCH-4521',
  motifAnnulation: null,
  lignes: [],
  lignesTronquees: false,
  creeLe: '2026-02-01T08:00:00.000Z',
  modifieLe: '2026-02-01T09:00:00.000Z',
};

function pageDe(
  donnees: readonly ReponseCommandeFournisseur[],
): PageCurseur<ReponseCommandeFournisseur> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pieces/commandes-fournisseur']}>
        <Routes>
          <Route
            path="/pieces/commandes-fournisseur"
            element={<EcranListeCommandesFournisseur />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranListeCommandesFournisseur — titre de page (doublon avec la vue « Commandes »)', () => {
  /**
   * Chantier « titres doublés & espacements » (contrat figé du 17.08.2026, §3) — défaut cité
   * nommément par @laupernoe : « Dans Commandes, "Commandes fournisseur" ». Le titre CONTIENT le libellé
   * de la vue active « Commandes » (`navigation-modele.ts`, `ONGLETS_PIECES`, vue « commandes » de
   * l'onglet Approvisionnement) — `GabaritEcran` doit le masquer par inclusion, jamais le retirer
   * du DOM.
   */
  it('le titre « Commandes fournisseur » reste dans le DOM mais est masqué visuellement', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    // La détection dépend du rôle en session (`useNavigationActive`) — le `<h1>` existe dès le
    // premier rendu mais ne devient `sr-only` qu'après résolution de la session (re-rendu).
    // RE-INTERROGE le DOM à chaque tentative de `waitFor` (pas une référence figée) : si le rôle
    // en session n'a pas le droit d'écrire (pas de bouton `actions`), `GabaritEcran` bascule sur
    // sa branche « anti-trou » et REMPLACE le nœud `<h1>` plutôt que de muter sa classe en place.
    await screen.findByRole('heading', { level: 1, name: 'Commandes fournisseur' });
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Commandes fournisseur' })).toHaveClass(
        'sr-only',
      );
    });
  });
});

describe('EcranListeCommandesFournisseur', () => {
  it('affiche les commandes avec leur statut et leur référence', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', () => HttpResponse.json(pageDe([COMMANDE]))),
    );

    rendre();

    expect(await screen.findByText('BOSCH-4521')).toBeInTheDocument();
    expect(screen.getByText('Envoyée')).toBeInTheDocument();
  });

  it('état vide : invite à créer la première commande', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', () => HttpResponse.json(pageDe([]))),
    );

    rendre();

    expect(await screen.findByText('Aucune commande fournisseur')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Créer une commande fournisseur' }).length).toBeGreaterThan(0);
  });

  it('état erreur : message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', () =>
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

    expect(await screen.findByText("Impossible d'afficher les commandes")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  // Preuve que la recherche atteint le SERVEUR (`q`), plus jamais un filtrage sur les lignes déjà
  // chargées : le mock ne renvoie une commande QUE si `q` est absent de la requête.
  it('la recherche envoie `q` au serveur — un terme inexistant rend la liste vide, pas un filtrage local', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/commandes-fournisseur', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q');
        return HttpResponse.json(pageDe(q ? [] : [COMMANDE]));
      }),
    );
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('BOSCH-4521')).toBeInTheDocument();

    await utilisateur.type(screen.getByRole('searchbox'), 'introuvable');

    expect(
      await screen.findByText('Aucune commande trouvée', {}, { timeout: 2000 }),
    ).toBeInTheDocument();
  });
});
