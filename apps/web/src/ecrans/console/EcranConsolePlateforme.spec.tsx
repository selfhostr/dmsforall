import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GarageConsole, ReponseSantePlateforme } from '@dfa/shared';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';
import type { RouteObject } from 'react-router';

import '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranConsolePlateforme } from './EcranConsolePlateforme';

// Même stub que `EcranRelances.spec.tsx`/`routeur.spec.tsx` : jsdom n'implémente pas
// `ResizeObserver`, utilisé au montage par les primitives Radix (ici `Select` du filtre statut).
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

const GARAGE_MARTIN: GarageConsole = {
  tenantId: 'tenant-martin',
  slug: 'garage-martin',
  raisonSociale: 'Garage Martin SA',
  statut: 'actif',
  creeLe: '2025-01-01T00:00:00.000Z',
  niveau: 'critique',
  alertes: [
    {
      code: 'export_comptable_rejete',
      niveau: 'critique',
      valeur: null,
      depuisLe: '2026-08-07T00:00:00.000Z',
      domaine: null,
    },
  ],
  sites: 1,
  utilisateursActifs: 4,
  sessionsActives: 2,
  comptesVerrouilles: 2,
  derniereConnexionReussieLe: '2026-08-08T11:56:00.000Z',
  connexionsEchouees24h: 0,
  dernierExportComptableLe: '2026-08-07T00:00:00.000Z',
  dernierExportComptableStatut: 'rejete',
  exportsComptablesRejetes30j: 1,
  relancesPlanifieesEnRetard: 0,
  relancesEnvoisEchoues7j: 0,
  ordresReparationActifs: 3,
  facturesEmisesImpayees: 1,
  modules: [],
};

const GARAGE_AUTO_CENTER: GarageConsole = {
  tenantId: 'tenant-auto-center',
  slug: 'auto-center',
  raisonSociale: 'Auto Center SA',
  statut: 'actif',
  creeLe: '2025-02-01T00:00:00.000Z',
  niveau: 'attention',
  alertes: [
    {
      code: 'comptes_verrouilles',
      niveau: 'attention',
      valeur: 1,
      depuisLe: '2026-08-08T09:00:00.000Z',
      domaine: null,
    },
  ],
  sites: 1,
  utilisateursActifs: 2,
  sessionsActives: 1,
  comptesVerrouilles: 1,
  derniereConnexionReussieLe: '2026-08-08T11:00:00.000Z',
  connexionsEchouees24h: 0,
  dernierExportComptableLe: '2026-08-06T00:00:00.000Z',
  dernierExportComptableStatut: 'accepte',
  exportsComptablesRejetes30j: 0,
  relancesPlanifieesEnRetard: 0,
  relancesEnvoisEchoues7j: 0,
  ordresReparationActifs: 1,
  facturesEmisesImpayees: 0,
  modules: [],
};

const GARAGE_ROSSI: GarageConsole = {
  tenantId: 'tenant-rossi',
  slug: 'garage-rossi-sion',
  raisonSociale: 'Garage Rossi',
  statut: 'actif',
  creeLe: '2025-03-01T00:00:00.000Z',
  niveau: 'ok',
  alertes: [],
  sites: 1,
  utilisateursActifs: 1,
  sessionsActives: 0,
  comptesVerrouilles: 0,
  derniereConnexionReussieLe: null,
  connexionsEchouees24h: 0,
  dernierExportComptableLe: null,
  dernierExportComptableStatut: null,
  exportsComptablesRejetes30j: 0,
  relancesPlanifieesEnRetard: 0,
  relancesEnvoisEchoues7j: 0,
  ordresReparationActifs: 0,
  facturesEmisesImpayees: 0,
  modules: [],
};

const ROUTES: RouteObject[] = [
  { path: '/console', element: <EcranConsolePlateforme /> },
  { path: '/console/garages/:tenantId', element: <p>Palier 2 — hors périmètre de ce lot</p> },
];

function rendre() {
  return renduAvecRoutes(ROUTES, { routeInitiale: '/console' });
}

function repondreGarages(garages: readonly GarageConsole[]) {
  const reponse: ReponseSantePlateforme = {
    resume: {
      observeLe: '2026-08-08T12:00:00.000Z',
      garages: garages.length,
      garagesActifs: garages.filter((g) => g.statut === 'actif').length,
      garagesSuspendus: garages.filter((g) => g.statut === 'suspendu').length,
      garagesResilies: garages.filter((g) => g.statut === 'resilie').length,
      sites: garages.reduce((s, g) => s + g.sites, 0),
      utilisateursActifs: garages.reduce((s, g) => s + g.utilisateursActifs, 0),
      sessionsActives: garages.reduce((s, g) => s + g.sessionsActives, 0),
      comptesVerrouilles: garages.reduce((s, g) => s + g.comptesVerrouilles, 0),
      connexionsReussies24h: 0,
      connexionsEchouees24h: 0,
      connexionsEchoueesSansTenant24h: 0,
      indicateursIndisponibles: [
        { code: 'erreurs_serveur_5xx' },
        { code: 'jobs_en_echec' },
        { code: 'disjoncteurs_connecteur_ouverts' },
        { code: 'connecteurs_configures' },
        { code: 'modules_souscrits' },
      ],
    },
    garages,
    curseurSuivant: null,
    limite: 200,
    seuils: { joursSansConnexion: 7, joursModuleSilencieux: 30 },
  };
  server.use(http.get('/api/v1/exploitation/sante-plateforme', () => HttpResponse.json(reponse)));
}

describe('EcranConsolePlateforme — nominal', () => {
  it('affiche les indicateurs (totaux plateforme) et la table triée statut décroissant', async () => {
    // Ordre d'entrée volontairement différent de l'ordre de sévérité attendu à l'écran.
    repondreGarages([GARAGE_ROSSI, GARAGE_AUTO_CENTER, GARAGE_MARTIN]);

    rendre();

    expect(await screen.findByText('Garage Martin SA')).toBeInTheDocument();

    const carteComptesVerrouilles = screen.getByRole('button', { name: /Comptes verrouillés/ });
    expect(within(carteComptesVerrouilles).getByText('3')).toBeInTheDocument(); // 2 + 1 + 0

    const carteCritiques = screen.getByRole('button', { name: /Garages en état critique/ });
    expect(within(carteCritiques).getByText('1')).toBeInTheDocument();

    // Indicateurs que ce lot ne sait pas mesurer par garage : affichés à part, jamais comme une
    // carte cliquable à zéro.
    expect(screen.getByText("Non mesuré pour l'instant :")).toBeInTheDocument();
    expect(screen.getByText('Erreurs serveur (24 h)')).toBeInTheDocument();

    // Chaque ligne de données porte un vrai `<button>` (nom accessible) dans sa colonne
    // identifiante — PAS `role="link"` sur le `<tr>` (correctif e2e, WCAG 1.3.1 : un `role`
    // réassigné sur le `<tr>` remplace son rôle `row` implicite au lieu de s'y ajouter, rendant la
    // table imparcourable en navigation par tableau au lecteur d'écran, non détecté par
    // axe-core — voir JSDoc `TableComptoir`). Le tri par défaut (statut décroissant) doit remonter
    // Martin (critique), puis Auto Center (attention), puis Rossi (ok), dans cet ordre exact.
    const lignes = screen.getAllByRole('button', { name: /^Entrer dans / });
    expect(lignes).toHaveLength(3);
    expect(lignes[0]).toHaveAccessibleName('Entrer dans Garage Martin SA');
    expect(lignes[1]).toHaveAccessibleName('Entrer dans Auto Center SA');
    expect(lignes[2]).toHaveAccessibleName('Entrer dans Garage Rossi');

    // Aucune donnée personnelle : ni nom de client, ni plaque, ni montant nulle part sur l'écran.
    expect(screen.queryByText(/CHF|\d+\.\d{2}/)).not.toBeInTheDocument();
  });

  it('Jamais connecté est distingué d’une date — absence de donnée ≠ valeur', async () => {
    repondreGarages([GARAGE_ROSSI]);
    rendre();
    expect(await screen.findByText('Jamais connecté')).toBeInTheDocument();
  });
});

describe('EcranConsolePlateforme — filtrage', () => {
  it('un clic sur une carte filtre la table et affiche le badge de filtre actif, retirable', async () => {
    repondreGarages([GARAGE_ROSSI, GARAGE_AUTO_CENTER, GARAGE_MARTIN]);
    rendre();
    const utilisateur = userEvent.setup();

    await screen.findByText('Garage Rossi');
    const carteCritiques = screen.getByRole('button', { name: /Garages en état critique/ });
    await utilisateur.click(carteCritiques);

    expect(carteCritiques).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Filtré : Garages en état critique/)).toBeInTheDocument();
    expect(screen.getByText('Garage Martin SA')).toBeInTheDocument();
    expect(screen.queryByText('Garage Rossi')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto Center SA')).not.toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Retirer le filtre' }));
    expect(carteCritiques).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByText('Garage Rossi')).toBeInTheDocument();
  });

  it('la recherche texte filtre sur le nom et l’identifiant du garage, entièrement côté client', async () => {
    repondreGarages([GARAGE_ROSSI, GARAGE_AUTO_CENTER, GARAGE_MARTIN]);
    rendre();
    const utilisateur = userEvent.setup();

    await screen.findByText('Garage Rossi');
    // « sion » n'est ni dans le nom ni dans l'identifiant de Martin/Auto Center, mais dans le
    // slug de Rossi (`garage-rossi-sion`) — le contrat `GarageConsole` (`@dfa/shared`) ne porte
    // ni ville ni canton, la recherche porte donc sur raisonSociale + slug uniquement.
    await utilisateur.type(screen.getByRole('searchbox'), 'sion');

    expect(screen.getByText('Garage Rossi')).toBeInTheDocument();
    expect(screen.queryByText('Garage Martin SA')).not.toBeInTheDocument();
    expect(screen.queryByText('Auto Center SA')).not.toBeInTheDocument();
  });

  it('affiche un état vide filtré (jamais un tableau muet) quand aucun garage ne correspond', async () => {
    repondreGarages([GARAGE_ROSSI]);
    rendre();
    const utilisateur = userEvent.setup();

    await screen.findByText('Garage Rossi');
    await utilisateur.type(screen.getByRole('searchbox'), 'inexistant');

    expect(await screen.findByText('Aucun garage ne correspond')).toBeInTheDocument();
    // Deux boutons « Effacer les filtres » coexistent ici : celui de la barre de filtres (BarreFiltres)
    // et celui intégré à l'état vide filtré (EtatVideFiltre) — les deux mènent au même geste.
    expect(screen.getAllByRole('button', { name: 'Effacer les filtres' }).length).toBeGreaterThan(
      0,
    );
  });
});

describe('EcranConsolePlateforme — état vide (aucun garage sur la plateforme)', () => {
  it('affiche un message géré par principe, jamais un tableau muet ni des données inventées', async () => {
    repondreGarages([]);
    rendre();
    expect(await screen.findByText('Aucun garage')).toBeInTheDocument();
  });
});

describe('EcranConsolePlateforme — état erreur', () => {
  it('affiche un message actionnable avec retry, qui recharge la vue en cas de succès', async () => {
    server.use(
      http.get('/api/v1/exploitation/sante-plateforme', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    const utilisateur = userEvent.setup();

    expect(await screen.findByText("Impossible d'afficher la vue plateforme")).toBeInTheDocument();
    expect(screen.getByText("Une erreur interne s'est produite. Réessayez.")).toBeInTheDocument();

    repondreGarages([GARAGE_ROSSI]);
    await utilisateur.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Garage Rossi')).toBeInTheDocument();
  });

  it('un 404 générique (module éteint, usage nominal) affiche un message dédié, sans bouton Réessayer', async () => {
    server.use(
      http.get('/api/v1/exploitation/sante-plateforme', () =>
        // Pas de header `application/problem+json` : c'est exactement le corps que Nest répond
        // quand le contrôleur n'est pas monté (`DATABASE_URL_CONSOLE` absente côté serveur) — la
        // même forme que `construireErreurApi` synthétise en `ERREUR_INTERNE` tout en préservant
        // `status: 404` depuis la réponse HTTP réelle.
        HttpResponse.json(
          {
            statusCode: 404,
            message: 'Cannot GET /api/v1/exploitation/sante-plateforme',
            error: 'Not Found',
          },
          { status: 404 },
        ),
      ),
    );
    rendre();

    expect(
      await screen.findByText("La console d'exploitation n'est pas activée sur ce serveur."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });

  it('un 403 (droit refusé) affiche un message dédié, sans bouton Réessayer', async () => {
    server.use(
      http.get('/api/v1/exploitation/sante-plateforme', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ACCES_REFUSE',
            title: 'Accès refusé',
            status: 403,
            code: 'ACCES_REFUSE',
            instance: 'req-2',
          },
          { status: 403, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();

    expect(await screen.findByText("Vous n'avez pas accès à la console.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).not.toBeInTheDocument();
  });
});

describe('EcranConsolePlateforme — navigation vers le palier 2', () => {
  it('le bouton Entrer navigue vers /console/garages/:tenantId (route hors périmètre de ce lot)', async () => {
    repondreGarages([GARAGE_MARTIN]);
    rendre();
    const utilisateur = userEvent.setup();

    await screen.findByText('Garage Martin SA');
    await utilisateur.click(screen.getByRole('button', { name: 'Entrer' }));

    expect(await screen.findByText('Palier 2 — hors périmètre de ce lot')).toBeInTheDocument();
  });
});
