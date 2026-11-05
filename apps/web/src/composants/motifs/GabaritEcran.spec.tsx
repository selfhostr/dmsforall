import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import type { RoleUtilisateur } from '@dfa/shared';

import { useSession } from '@/hooks/useSession';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { estTitreDoublonNavigation, GabaritEcran } from './GabaritEcran';

/**
 * Ce composant lit désormais la session (`useSession`) et l'URL (`useLocation`/`useSearchParams`,
 * via `useNavigationActive`, `composants/layout/useNavigationActive.ts`) pour détecter un titre en
 * double avec la navigation — même wrapping de test que `OngletsDomaine.spec.tsx`, sur lequel cette
 * détection s'aligne délibérément (source unique, voir l'en-tête de `useNavigationActive.ts`).
 *
 * IMPORTANT (jsdom) : jsdom ne fait AUCUN layout — impossible d'y mesurer une hauteur en pixels. La
 * règle anti-trou (§4 du contrat) est donc vérifiée sur la STRUCTURE rendue (le h1 `sr-only` est un
 * enfant direct du conteneur `gap-6`, jamais enveloppé dans la ligne d'en-tête vide qui continuerait
 * à consommer un `gap`), pas sur une mesure de rendu — c'est la garantie que peut réellement donner
 * un test jsdom pour cette règle.
 */
function connecte(role: RoleUtilisateur): void {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({
        ...SESSION_TEST,
        utilisateur: { ...SESSION_TEST.utilisateur, role },
      }),
    ),
  );
}

function rendre(routeInitiale: string, ui: ReactElement) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/** SANS `MemoryRouter` — le cas qui a cassé `EcranRelances.spec.tsx` (lot facturation,
 *  17.08.2026) avant que ce socle ne rende `useNavigationActive` tolérant à l'absence de Router. */
function rendreSansRouteur(ui: ReactElement) {
  const queryClient = creerQueryClientTest();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/**
 * `findByRole` résout dès que le h1 EXISTE — toujours vrai dès le premier rendu (le h1 est
 * TOUJOURS dans le DOM, visible ou non). La détection de doublon dépend, elle, de `useSession()`
 * (asynchrone, résolue via msw) : tant que le rôle n'est pas encore connu, les onglets/vues
 * GOUVERNÉS (qui portent `roles`) ne comptent pas encore comme affichés (`estAutorise`) — le h1
 * peut donc rester visible un court instant avant de devenir `sr-only`. Une simple `findByRole` ne
 * capture pas cette stabilisation, elle rend l'élément dès son tout premier rendu ; `waitFor` si.
 */
async function attendreTitreMasque(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 1 })).toHaveClass('sr-only');
  });
  return screen.getByRole('heading', { level: 1 });
}

describe('GabaritEcran — comportement de base (hors détection de doublon)', () => {
  it('un h1 hors de toute route connue reste visible par défaut', async () => {
    connecte('direction');
    rendre(
      '/recherche',
      <GabaritEcran titre="Clients">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await screen.findByRole('heading', { level: 1, name: 'Clients' });
    expect(titre).not.toHaveClass('sr-only');
  });

  it('`titreVisible={false}` explicite garde la priorité même sans doublon détecté', async () => {
    connecte('direction');
    rendre(
      '/recherche',
      <GabaritEcran titre="Articles" titreVisible={false}>
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await screen.findByRole('heading', { level: 1, name: 'Articles' });
    expect(titre).toHaveClass('sr-only');
  });

  it('`titreVisible={true}` explicite force la visibilité même en cas de doublon détecté', async () => {
    connecte('chef_atelier');
    rendre(
      '/ordres-reparation',
      <GabaritEcran titre="Ordres de réparation" titreVisible>
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await screen.findByRole('heading', { level: 1, name: 'Ordres de réparation' });
    expect(titre).not.toHaveClass('sr-only');
  });

  it('rend le sous-titre sous le titre, dans la même colonne', async () => {
    connecte('direction');
    rendre(
      '/recherche',
      <GabaritEcran titre="Clients" sousTitre="12 fiches probablement en double">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Clients' });
    expect(screen.getByText('12 fiches probablement en double')).toBeInTheDocument();
  });

  it('rend les actions à droite du titre quand elles sont fournies', async () => {
    connecte('direction');
    rendre(
      '/recherche',
      <GabaritEcran titre="Clients" actions={<button type="button">Nouveau client</button>}>
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Clients' });
    expect(screen.getByRole('button', { name: 'Nouveau client' })).toBeInTheDocument();
  });

  it("n'ajoute aucun padding ni largeur maximale : pleine largeur, un seul espacement", async () => {
    connecte('direction');
    const { container } = rendre(
      '/recherche',
      <GabaritEcran titre="Comptoir">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Comptoir' });
    const racine = container.firstElementChild;
    expect(racine).toHaveClass('w-full');
    expect(racine?.className).not.toMatch(/\bp-\d/);
    expect(racine?.className).not.toMatch(/max-w-/);
  });

  it('rend les enfants après le titre', async () => {
    connecte('direction');
    rendre(
      '/recherche',
      <GabaritEcran titre="Clients">
        <p>Barre de filtres puis tableau</p>
      </GabaritEcran>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Clients' });
    expect(screen.getByText('Barre de filtres puis tableau')).toBeInTheDocument();
  });

  it('le h1 reste TOUJOURS dans le DOM, y compris masqué', async () => {
    connecte('chef_atelier');
    rendre(
      '/ordres-reparation',
      <GabaritEcran titre="Ordres de réparation">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await attendreTitreMasque();
    expect(titre).toBeInTheDocument();
  });
});

describe('GabaritEcran — tolérance à l’absence de Router (`useNavigationActive`)', () => {
  /**
   * `useLocation`/`useSearchParams` exigent un `<Router>` ancêtre — sans la tolérance posée dans
   * `useNavigationActive.ts`, ce rendu planterait avec `useLocation() may be used only in the
   * context of a <Router> component.`, un message qui ne nomme jamais `GabaritEcran`. Régression
   * concrète rencontrée par le lot facturation sur `EcranRelances.spec.tsx` avant correctif.
   */
  it('rendu sans MemoryRouter : ne plante pas, le titre reste visible (dégrade comme une route hors arborescence)', async () => {
    connecte('direction');
    rendreSansRouteur(
      <GabaritEcran titre="Clients">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await screen.findByRole('heading', { level: 1, name: 'Clients' });
    expect(titre).not.toHaveClass('sr-only');
  });

  it('rendu sans MemoryRouter : `titreVisible={false}` explicite reste respecté', async () => {
    connecte('direction');
    rendreSansRouteur(
      <GabaritEcran titre="Articles" titreVisible={false}>
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await screen.findByRole('heading', { level: 1, name: 'Articles' });
    expect(titre).toHaveClass('sr-only');
  });
});

describe('GabaritEcran — session en erreur : jamais de blocage', () => {
  /**
   * Régression réelle (lot transverses, 17.08.2026) : `routes/RouteProtegee.spec.tsx`, test
   * « isError », bloquait 15 s parce qu'un SECOND observateur ACTIF de `useSession()` (celui posé
   * ici avant correctif) déclenchait son propre refetch sur une requête déjà en erreur, refetch qui
   * ne se résolvait jamais dans ce scénario. `useNavigationActive` lit désormais la session de façon
   * PASSIVE (`enabled: false`, voir son en-tête) : ce test monte un vrai `useSession()` ACTIF à côté
   * de `GabaritEcran`, pour pousser la requête à un véritable état d'erreur, exactement comme le
   * ferait `RouteProtegee` en amont dans l'application réelle.
   */
  it('titre visible IMMÉDIATEMENT quand la session est en erreur, sans attendre sa résolution', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.error()));

    function ArbreAvecSessionActive() {
      useSession();
      return (
        <GabaritEcran titre="Ordres de réparation">
          <p>Contenu</p>
        </GabaritEcran>
      );
    }
    rendre('/ordres-reparation', <ArbreAvecSessionActive />);

    // Timeout resserré à 200 ms — largement en-deçà des 15 s de blocage constatées avant correctif —
    // pour prouver une visibilité immédiate, jamais une attente déguisée en assertion tardive.
    await waitFor(
      () => {
        expect(
          screen.getByRole('heading', { level: 1, name: 'Ordres de réparation' }),
        ).not.toHaveClass('sr-only');
      },
      { timeout: 200 },
    );
  });
});

describe('GabaritEcran — règle anti-trou (§4 du contrat)', () => {
  it('h1 masqué, ni sous-titre ni actions : aucune ligne d’en-tête, le h1 est un enfant direct du conteneur', async () => {
    connecte('chef_atelier');
    const { container } = rendre(
      '/ordres-reparation',
      <GabaritEcran titre="Ordres de réparation">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await attendreTitreMasque();

    const racine = container.firstElementChild;
    expect(racine).not.toBeNull();
    // Le h1 est le PREMIER enfant direct du conteneur `gap-6` — aucune `div` de ligne d'en-tête ne
    // l'enveloppe, donc aucune ne consomme le `gap` avant le contenu.
    expect(racine?.firstElementChild?.tagName).toBe('H1');
    expect(racine?.firstElementChild).toBe(titre);
  });

  it('h1 masqué MAIS sous-titre présent : la ligne d’en-tête est rendue (pas d’anti-trou)', async () => {
    connecte('chef_atelier');
    const { container } = rendre(
      '/ordres-reparation',
      <GabaritEcran titre="Ordres de réparation" sousTitre="Filtré sur aujourd'hui">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();

    const racine = container.firstElementChild;
    expect(racine?.firstElementChild?.tagName).toBe('DIV');
    expect(screen.getByText("Filtré sur aujourd'hui")).toBeInTheDocument();
  });

  it('h1 masqué MAIS actions présentes : la ligne d’en-tête est rendue (pas d’anti-trou)', async () => {
    connecte('chef_atelier');
    const { container } = rendre(
      '/ordres-reparation',
      <GabaritEcran titre="Ordres de réparation" actions={<button type="button">Nouvel OR</button>}>
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();

    const racine = container.firstElementChild;
    expect(racine?.firstElementChild?.tagName).toBe('DIV');
    expect(screen.getByRole('button', { name: 'Nouvel OR' })).toBeInTheDocument();
  });

  it('h1 visible : la ligne d’en-tête est toujours rendue', async () => {
    connecte('direction');
    const { container } = rendre(
      '/recherche',
      <GabaritEcran titre="Clients">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Clients' });
    const racine = container.firstElementChild;
    expect(racine?.firstElementChild?.tagName).toBe('DIV');
  });
});

describe('GabaritEcran — détection automatique du doublon, route par route (table §3 du contrat)', () => {
  it('Atelier > Ordres de réparation : le titre égal à l’onglet actif est masqué', async () => {
    connecte('chef_atelier');
    rendre(
      '/ordres-reparation',
      <GabaritEcran titre="Ordres de réparation">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('Pointage > Mon travail : le titre égal à la VUE active est masqué (niveau le plus profond)', async () => {
    connecte('technicien');
    rendre(
      '/pointage',
      <GabaritEcran titre="Mon travail">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('Pièces > Comptoir : « Recherche comptoir » contient le libellé d’onglet « Comptoir » — masqué', async () => {
    connecte('magasinier');
    rendre(
      '/pieces/recherche-comptoir',
      <GabaritEcran titre="Recherche comptoir">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('Pièces > Approvisionnement : « Réapprovisionnement » contient le libellé d’onglet « Approvisionnement » — masqué', async () => {
    connecte('magasinier');
    rendre(
      '/pieces/reapprovisionnement',
      <GabaritEcran titre="Réapprovisionnement">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('Pièces > Commandes : « Commandes fournisseur » contient le libellé de vue « Commandes » — masqué', async () => {
    connecte('magasinier');
    rendre(
      '/pieces/commandes-fournisseur',
      <GabaritEcran titre="Commandes fournisseur">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('Facturation > Factures : le titre égal à l’onglet actif est masqué', async () => {
    connecte('comptable');
    rendre(
      '/factures',
      <GabaritEcran titre="Factures">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('Ventes > Dossiers : « Dossiers de vente » contient le libellé d’onglet « Dossiers » — masqué', async () => {
    connecte('vendeur');
    rendre(
      '/ventes/dossiers',
      <GabaritEcran titre="Dossiers de vente">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('Clients & véhicules > Véhicules : le titre égal à l’onglet actif est masqué', async () => {
    connecte('direction');
    rendre(
      '/vehicules',
      <GabaritEcran titre="Véhicules">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    await attendreTitreMasque();
  });

  it('contre-exemple : « Nouvelle commande fournisseur » (singulier) reste VISIBLE face à « Commandes » (pluriel)', async () => {
    connecte('magasinier');
    rendre(
      '/pieces/commandes-fournisseur/nouveau',
      <GabaritEcran titre="Nouvelle commande fournisseur">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await screen.findByRole('heading', { level: 1 });
    expect(titre).not.toHaveClass('sr-only');
  });

  it('contre-exemple : le titre de fiche « Facture F-2026-000123 » reste VISIBLE face à « Factures »', async () => {
    connecte('comptable');
    rendre(
      '/factures/f-2026-000123',
      <GabaritEcran titre="Facture F-2026-000123">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = await screen.findByRole('heading', { level: 1 });
    expect(titre).not.toHaveClass('sr-only');
  });
});

describe('estTitreDoublonNavigation — fonction pure, filet rapide indépendant du routeur', () => {
  it.each([
    ['Ordres de réparation', ['Ordres de réparation'], true],
    ['Recherche comptoir', ['Comptoir'], true],
    ['Réapprovisionnement', ['Approvisionnement'], true],
    ['Commandes fournisseur', ['Commandes'], true],
    ['Dossiers de vente', ['Dossiers'], true],
    ['Factures', ['Factures'], true],
    ['Véhicules', ['Véhicules'], true],
    ['Nouvelle commande fournisseur', ['Commandes'], false],
    ['Facture F-2026-000123', ['Factures'], false],
    ['Clients & véhicules', ['Clients et véhicules'], true],
  ] as const)('%s vs %j -> doublon = %s', (titre, libelles, attendu) => {
    expect(estTitreDoublonNavigation(titre, libelles)).toBe(attendu);
  });

  it('aucun libellé affiché : jamais de doublon', () => {
    expect(estTitreDoublonNavigation('Clients', [])).toBe(false);
  });
});
