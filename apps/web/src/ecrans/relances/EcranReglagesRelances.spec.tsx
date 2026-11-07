import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ReponseRegleRelance } from '@dfa/shared';

import '@/i18n';

import { routesConfig } from '@/routes/routeur';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient, renduAvecRoutes } from '@/test/utils';

import { EcranReglagesRelances } from './EcranReglagesRelances';

const REGLE_FACTURE_ECHUE: ReponseRegleRelance = {
  typeRelance: 'facture_echue',
  actif: true,
  delaisJours: [10, 20, 30],
  canaux: ['email'],
  texteModeleId: null,
  prereglageAppliqueLe: '2026-08-01T08:00:00.000Z',
  creeLe: '2026-07-01T08:00:00.000Z',
  modifieLe: '2026-08-01T08:00:00.000Z',
};

// jsdom (26.1, `src/test/environnementJsdomFetch.ts`) n'implémente PAS `ResizeObserver` — un vrai
// navigateur si. Le formulaire de modification manuelle monte des cases `@radix-ui/react-checkbox`
// qui l'utilisent inconditionnellement au montage (`CheckboxBubbleInput`, `useSize(control)`).
// Même stub, scopé à ce fichier, que `EcranRelances.spec.tsx`/`routes/routeur.spec.tsx`.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
  }
});

/** `GabaritEcran` résout sa détection automatique de doublon via `useNavigationActive`
 *  (`useLocation`/`useSearchParams`) — un Router de test est donc requis, même pour un rendu isolé
 *  de l'écran (`MemoryRouter` seul suffit, pas besoin du jeu de routes complet comme
 *  `renduAvecRoutes` ci-dessous, réservé aux tests de garde de rôle). */
function rendre() {
  return renduAvecQueryClient(
    <MemoryRouter initialEntries={['/parametrage/relances']}>
      <EcranReglagesRelances />
    </MemoryRouter>,
  );
}

describe('EcranReglagesRelances — nominal', () => {
  it('affiche la règle du rappel facture échue quand elle est configurée', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rappels de paiement' })).toBeInTheDocument();
    expect(screen.getByText('Palier 1', { exact: false })).toBeInTheDocument();
    expect(screen.getByText("10 jours après l'échéance", { exact: false })).toBeInTheDocument();
    expect(screen.getByText('E-mail')).toBeInTheDocument();
    expect(screen.getByText('Préréglage appliqué le 01.08.2026.')).toBeInTheDocument();
  });
});

describe('EcranReglagesRelances — état vide (aucune règle configurée)', () => {
  it('propose le préréglage recommandé et l’applique via le même PUT que la modification manuelle', async () => {
    let corpsRecu: unknown = null;
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([])),
      http.put('/api/v1/relances/regles/facture_echue', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          ...REGLE_FACTURE_ECHUE,
          prereglageAppliqueLe: '2026-08-06T08:00:00.000Z',
        });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    expect(await screen.findByText('Aucune règle configurée')).toBeInTheDocument();
    const bouton = screen.getByRole('button', { name: 'Activer le préréglage recommandé' });
    await utilisateur.click(bouton);

    await waitFor(() =>
      expect(corpsRecu).toEqual({ actif: true, delaisJours: [10, 20, 30], canaux: ['email'] }),
    );
  });
});

describe('EcranReglagesRelances — état erreur', () => {
  it('affiche un message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/relances/regles', () =>
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

    expect(await screen.findByText("Impossible d'afficher les relances")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});

describe('EcranReglagesRelances — modification manuelle', () => {
  it('ouvre le formulaire pré-rempli, corrige un palier invalide puis enregistre', async () => {
    let corpsRecu: unknown = null;
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
      http.put('/api/v1/relances/regles/facture_echue', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(REGLE_FACTURE_ECHUE);
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));

    const champsPaliers = screen.getAllByPlaceholderText('Jours');
    expect(champsPaliers).toHaveLength(3);

    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(corpsRecu).toEqual({ actif: true, delaisJours: [10, 20, 30], canaux: ['email'] }),
    );
  });

  it('refuse un palier retiré sans remplaçant quand la règle reste active (validation zod partagée)', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));

    for (const nom of ['Retirer le palier 3', 'Retirer le palier 2', 'Retirer le palier 1']) {
      await utilisateur.click(screen.getByRole('button', { name: nom }));
    }
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText('Ajoutez au moins une étape pour activer les rappels de paiement.'),
    ).toBeInTheDocument();
  });

  it('annuler referme le formulaire sans muter', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifier la règle' })).toBeInTheDocument();
  });
});

/**
 * Câblage route + masquage par rôle (`ROLES_RELANCES`, `routes/droits-routes.ts`) — même patron
 * que `routeur.spec.tsx` (« /pieces/* refuse admin ») et que `EcranRelances.spec.tsx` pour la route
 * jumelle `/relances` : un rôle hors `direction`/`comptable` doit recevoir l'écran de refus DÉDIÉ,
 * jamais le contenu réel.
 */
describe('routeur — /parametrage/relances refuse les rôles hors direction/comptable', () => {
  it('technicien : reçoit l’écran de refus dédié, jamais le contenu réel', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
        }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/parametrage/relances' });

    expect(
      await screen.findByText(
        "Votre rôle ne permet pas cette action. Demandez à la direction de vous l'ouvrir, ou faites-la faire par un collègue autorisé.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Rappels de paiement' })).not.toBeInTheDocument();
  });

  it('direction : atteint le contenu réel de /parametrage/relances', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' },
        }),
      ),
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/parametrage/relances' });

    expect(await screen.findByRole('heading', { name: 'Rappels de paiement' })).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Votre rôle ne permet pas cette action. Demandez à la direction de vous l'ouvrir, ou faites-la faire par un collègue autorisé.",
      ),
    ).not.toBeInTheDocument();
  });
});
