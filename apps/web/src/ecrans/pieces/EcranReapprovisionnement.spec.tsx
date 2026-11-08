import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

/**
 * Chantier « titres doublés & espacements » (contrat figé du 17.08.2026, §3) — défaut cité
 * nommément par @laupernoe : « Dans Approvisionnement, c'est écrit "Réapprovisionnement" ». « Réapprovisionnement »
 * (`pieces:stock.reapprovisionnement.titre`) CONTIENT le libellé de l'onglet actif « Approvisionnement »
 * (`navigation-modele.ts`, `ONGLETS_PIECES`) — `GabaritEcran` doit le masquer par inclusion,
 * jamais le retirer du DOM.
 */
describe('EcranReapprovisionnement — titre de page (doublon avec l’onglet « Approvisionnement »)', () => {
  it('le titre « Réapprovisionnement » reste dans le DOM mais est masqué visuellement', async () => {
    connecterSession();
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );
    rendre();

    // La détection dépend du rôle en session (`useNavigationActive`) — le `<h1>` existe dès le
    // premier rendu mais ne devient `sr-only` qu'après résolution de la session (re-rendu). Cet
    // écran ne pose ni `sousTitre` ni `actions` sur `GabaritEcran` : la bascule visible -> masqué
    // fait passer par sa branche « anti-trou », qui REMPLACE le nœud `<h1>` (structure JSX
    // différente) au lieu de muter sa classe en place. On RE-INTERROGE le DOM à chaque tentative
    // de `waitFor`, jamais une référence figée avant la résolution de session.
    await screen.findByRole('heading', {
      level: 1,
      name: i18n.t('pieces:stock.reapprovisionnement.titre'),
    });
    await waitFor(() => {
      expect(
        screen.getByRole('heading', {
          level: 1,
          name: i18n.t('pieces:stock.reapprovisionnement.titre'),
        }),
      ).toHaveClass('sr-only');
    });
  });
});

describe('EcranReapprovisionnement — états de base', () => {
  it('ouvre sur le site principal sans rien demander (garage à deux sites)', async () => {
    server.use(
      http.get(CHEMIN, () => HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 })),
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          sitePrincipalId: 'site-1',
          sites: [
            ...SESSION_TEST.sites,
            { id: 'site-2', code: 'S2', codeCourt: 'S2', nom: 'Second site', actif: true },
          ],
        }),
      ),
    );
    rendre('/pieces/reapprovisionnement');

    expect(
      await screen.findByRole('combobox', { name: i18n.t('commun:filtreSite.libelle') }),
    ).toBeInTheDocument();
    expect(screen.queryByText(i18n.t('pieces:siteRequis.titre'))).not.toBeInTheDocument();
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
          // Pas de `quantiteCommandeStandardMillieme` pour cette ligne : `ecartMillieme` seul.
          quantiteSuggereeMillieme: 4000,
        },
        {
          articleId: 'art-2',
          numeroArticle: 'P-000456',
          designation: 'Filtre à huile',
          // DÉFAUT CORRIGÉ (n°4, test manuel du 14.08.2026) : `quantiteCommandeStandardMillieme`
          // (6000, lot fournisseur habituel) NE prime PLUS sur `ecartMillieme` (3000, quantité
          // RÉELLEMENT manquante) — avant ce correctif, cette assertion valait 6000 : elle
          // encodait le défaut lui-même, pas le comportement attendu. `ecartMillieme` est
          // TOUJOURS la quantité proposée : celle qui fait repasser l'article au-dessus du seuil.
          quantiteSuggereeMillieme: 3000,
        },
      ],
    });
  });
});

/**
 * Ticket #121 — le seuil n'avait aucun point de saisie côté écran (l'API le prenait déjà en
 * charge, hook `useModifierStockSite` posé mais jamais consommé). Ce bloc prouve le CÂBLAGE : la
 * valeur pré-remplie est la vraie valeur du seuil (jamais vide par défaut, cf. commentaire de
 * `CelluleSeuil`), une saisie valide part en `PATCH`, un champ vidé retire le seuil (`null`,
 * distinct d'un zéro — voir `saisieVersSeuilMillieme`), et un rôle sans droit ne voit qu'une
 * valeur affichée, sans déclencheur.
 */
describe('EcranReapprovisionnement — seuil de réapprovisionnement (#121)', () => {
  function reponseStock(articleId: string, siteId: string, stockMinimumMillieme: number | null) {
    return {
      articleId,
      siteId,
      quantitePhysiqueMillieme: 10000,
      quantiteReserveeMillieme: 0,
      quantiteDisponibleMillieme: 10000,
      emplacement: null,
      stockMinimumMillieme,
      quantiteCommandeStandardMillieme: null,
      modifieLe: '2026-08-13T00:00:00.000Z',
    };
  }

  it('un rôle habilité (magasinier) modifie le seuil : la valeur pré-remplie est la vraie valeur, la requête part avec la nouvelle', async () => {
    connecterSession('magasinier');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/articles/art-1/stock/site-1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(reponseStock('art-1', 'site-1', 8000));
      }),
    );

    rendre();
    await screen.findByText('Plaquettes de frein avant');

    const utilisateur = userEvent.setup();
    const declencheur = screen.getByRole('button', {
      name: i18n.t('pieces:stock.reapprovisionnement.seuil.modifierAria', {
        designation: 'Plaquettes de frein avant',
      }),
    });
    await utilisateur.click(declencheur);

    const champ = await screen.findByLabelText(
      i18n.t('pieces:stock.reapprovisionnement.seuil.champ'),
    );
    // Pré-rempli avec la vraie valeur du seuil (5000 millièmes -> "5"), jamais vide.
    expect(champ).toHaveValue('5');

    await utilisateur.clear(champ);
    await utilisateur.type(champ, '8');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(corpsRecu).toEqual({ stockMinimumMillieme: 8000 });
  });

  it('un champ vidé puis enregistré retire le seuil (`null`, pas `0`)', async () => {
    connecterSession('direction');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/articles/art-1/stock/site-1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(reponseStock('art-1', 'site-1', null));
      }),
    );

    rendre();
    await screen.findByText('Plaquettes de frein avant');

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.reapprovisionnement.seuil.modifierAria', {
          designation: 'Plaquettes de frein avant',
        }),
      }),
    );
    const champ = await screen.findByLabelText(
      i18n.t('pieces:stock.reapprovisionnement.seuil.champ'),
    );
    await utilisateur.clear(champ);
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(corpsRecu).toEqual({ stockMinimumMillieme: null });
  });

  it('« Retirer le seuil » envoie directement `null`, sans passer par le champ', async () => {
    connecterSession('chef_atelier');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/articles/art-2/stock/site-1', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(reponseStock('art-2', 'site-1', null));
      }),
    );

    rendre();
    await screen.findByText('Filtre à huile');

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.reapprovisionnement.seuil.modifierAria', {
          designation: 'Filtre à huile',
        }),
      }),
    );
    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.reapprovisionnement.seuil.retirer'),
      }),
    );

    expect(corpsRecu).toEqual({ stockMinimumMillieme: null });
  });

  it('une saisie à zéro affiche une erreur explicite et ne part JAMAIS au serveur (le contrat rejette `0`, distinct de l’absence)', async () => {
    connecterSession('magasinier');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );
    let appele = false;
    server.use(
      http.patch('/api/v1/articles/art-1/stock/site-1', () => {
        appele = true;
        return HttpResponse.json(reponseStock('art-1', 'site-1', 0));
      }),
    );

    rendre();
    await screen.findByText('Plaquettes de frein avant');

    const utilisateur = userEvent.setup();
    await utilisateur.click(
      screen.getByRole('button', {
        name: i18n.t('pieces:stock.reapprovisionnement.seuil.modifierAria', {
          designation: 'Plaquettes de frein avant',
        }),
      }),
    );
    const champ = await screen.findByLabelText(
      i18n.t('pieces:stock.reapprovisionnement.seuil.champ'),
    );
    await utilisateur.clear(champ);
    await utilisateur.type(champ, '0');
    await utilisateur.click(
      screen.getByRole('button', { name: i18n.t('commun:actions.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('pieces:stock.reapprovisionnement.seuil.erreurInvalide')),
    ).toBeInTheDocument();
    expect(appele).toBe(false);
  });

  it('un rôle sans droit (technicien) voit la valeur du seuil, sans déclencheur de modification', async () => {
    connecterSession('technicien');
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ donnees: LIGNES, curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();
    await screen.findByText('Plaquettes de frein avant');

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: i18n.t('pieces:stock.reapprovisionnement.seuil.modifierAria', {
          designation: 'Plaquettes de frein avant',
        }),
      }),
    ).not.toBeInTheDocument();
  });
});
