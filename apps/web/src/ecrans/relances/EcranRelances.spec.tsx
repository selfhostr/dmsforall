import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ReponseRegleRelance } from '@dfa/shared';

import '@/i18n';

import { routesConfig } from '@/routes/routeur';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient, renduAvecRoutes } from '@/test/utils';

import { EcranRelances } from './EcranRelances';

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
// Même stub, scopé à ce fichier, que `routes/routeur.spec.tsx`/`EcranNouveauVehicule.spec.tsx`.
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

function rendre() {
  return renduAvecQueryClient(<EcranRelances />);
}

describe('EcranRelances — nominal', () => {
  it('affiche la règle du rappel facture échue quand elle est configurée', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Relances automatiques' })).toBeInTheDocument();
    expect(screen.getByText('Palier 1', { exact: false })).toBeInTheDocument();
    expect(screen.getByText("10 jours après l'échéance", { exact: false })).toBeInTheDocument();
    expect(screen.getByText('E-mail')).toBeInTheDocument();
    expect(screen.getByText('Préréglage appliqué le 01.08.2026.')).toBeInTheDocument();
  });
});

describe('EcranRelances — état vide (aucune règle configurée)', () => {
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

describe('EcranRelances — état erreur', () => {
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

describe('EcranRelances — déclenchement manuel', () => {
  it('planifier maintenant : appelle la mutation et affiche le bilan', async () => {
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
      http.post('/api/v1/relances/facturation/planifier', () =>
        HttpResponse.json({ creees: 3, ignorees: 1, encoreATraiter: false }),
      ),
    );

    rendre();
    const utilisateur = userEvent.setup();

    const bouton = await screen.findByRole('button', { name: 'Planifier maintenant' });
    await utilisateur.click(bouton);

    expect(await screen.findByText('3 rappels créés')).toBeInTheDocument();
    expect(screen.getByText('1 déjà planifié', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Tout est traité.')).toBeInTheDocument();
  });

  it('envoyer maintenant : appelle la mutation et affiche le bilan', async () => {
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
      http.post('/api/v1/relances/facturation/envoyer', () =>
        HttpResponse.json({ envoyees: 2, echouees: 0, annulees: 1, encoreATraiter: true }),
      ),
    );

    rendre();
    const utilisateur = userEvent.setup();

    const bouton = await screen.findByRole('button', { name: 'Envoyer maintenant' });
    await utilisateur.click(bouton);

    expect(await screen.findByText('2 rappels envoyés')).toBeInTheDocument();
    expect(screen.getByText('aucun échec', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('1 annulation', { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText("D'autres rappels restent à envoyer — relancez pour continuer."),
    ).toBeInTheDocument();
  });
});

describe('EcranRelances — modification manuelle', () => {
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
      await screen.findByText('Ajoutez au moins un palier pour activer les rappels.'),
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
 * que `routeur.spec.tsx` (« /pieces/* refuse admin ») : un rôle hors `direction`/`comptable` doit
 * recevoir l'écran de refus DÉDIÉ, jamais le contenu réel.
 */
describe('routeur — /relances refuse les rôles hors direction/comptable', () => {
  it('technicien : reçoit l’écran de refus dédié, jamais le contenu réel', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
        }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/relances' });

    expect(
      await screen.findByText("Vous n'avez pas les droits pour cette action."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Relances automatiques' }),
    ).not.toBeInTheDocument();
  });

  it('direction : atteint le contenu réel de /relances', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' },
        }),
      ),
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/relances' });

    expect(
      await screen.findByRole('heading', { name: 'Relances automatiques' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Vous n'avez pas les droits pour cette action."),
    ).not.toBeInTheDocument();
  });
});
