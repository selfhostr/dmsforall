import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import type { RoleUtilisateur } from '@dfa/shared';

import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { OngletsDomaine } from './OngletsDomaine';

/**
 * Le SECOND NIVEAU du Lot D. Ce que ces tests protègent, c'est la promesse centrale de la refonte :
 * « 30 entrées -> 6, aucun écran supprimé, aucun rendu inatteignable ». Les vingt-quatre entrées
 * retirées de la barre latérale sont ici, et si cette rangée cesse de se rendre, elles disparaissent
 * toutes d'un coup sans qu'aucun autre test ne rougisse.
 */
function rendre(routeInitiale: string): RenderResult & { queryClient: QueryClient } {
  const queryClient = creerQueryClientTest();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[routeInitiale]}>
          <OngletsDomaine />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

/** Même rendu que `rendre`, sous `FournisseurSiteCourant` — seul moyen d'exercer la préférence de
 *  site mémorisée (`hooks/site/ContexteSiteCourant.tsx`, issue #91). */
function rendreAvecPreferenceSite(routeInitiale: string): void {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <FournisseurSiteCourant>
          <OngletsDomaine />
        </FournisseurSiteCourant>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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

function libelles(nav: HTMLElement): string[] {
  return within(nav)
    .getAllByRole('link')
    .map((lien) => lien.textContent?.trim() ?? '');
}

describe('OngletsDomaine — les onglets d’un domaine', () => {
  it('Atelier : Ordres de réparation, Rendez-vous, Courtoisie, Pointage et Dépôt pneus — les entrées de menu retirées, retrouvées ici', async () => {
    connecte('chef_atelier');
    rendre('/ordres-reparation');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    // « Planning » (Lot RDV-1, slot activé dans `navigation-modele.ts`) prend la deuxième place,
    // entre Ordres de réparation et Pointage — exactement l'emplacement tenu par
    // `EMPLACEMENTS_RESERVES` avant son activation.
    expect(libelles(onglets)).toEqual([
      'Ordres de réparation',
      'Planning',
      'Courtoisie',
      'Pointage',
      'Dépôt pneus',
    ]);
  });

  it('Pièces : Comptoir, Articles, Approvisionnement, Consignes — six entrées de menu devenues quatre onglets', async () => {
    connecte('magasinier');
    rendre('/pieces/articles');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(libelles(onglets)).toEqual(['Comptoir', 'Articles', 'Approvisionnement', 'Consignes']);
  });

  it('Ventes : Dossiers en premier — c’est l’atterrissage du vendeur', async () => {
    connecte('vendeur');
    rendre('/ventes/stock');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(libelles(onglets)).toEqual([
      'Ventes en cours',
      'Véhicules en stock',
      'Suivi financement & garantie',
    ]);
  });

  it('l’onglet courant se dit aux lecteurs d’écran, et lui seul', async () => {
    connecte('vendeur');
    rendre('/ventes/stock');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(within(onglets).getByRole('link', { name: /véhicules en stock/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(onglets).getByRole('link', { name: /^ventes en cours$/i })).not.toHaveAttribute(
      'aria-current',
    );
  });

  /** Une fiche appartient au domaine de son objet : sans ça, ouvrir un dossier ferait disparaître
   *  le repère « je suis dans Ventes » au moment précis où on en a le plus besoin. */
  it('une fiche garde l’onglet de son domaine surligné', async () => {
    connecte('vendeur');
    rendre('/ventes/dossiers/42');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(within(onglets).getByRole('link', { name: /^ventes en cours$/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  /**
   * Issue #44, second cas trouvé en vérifiant le reste du fichier : `pieces.consigne.lire`
   * n'est accordé qu'à `direction`/`chef_atelier`/`magasinier`/`comptable` — un `vendeur` ne doit
   * pas voir l'onglet Consignes du tout (avant correctif, il le voyait et se heurtait à un `403`).
   */
  it('Pièces : un vendeur ne voit pas Consignes', async () => {
    connecte('vendeur');
    rendre('/pieces/articles');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(libelles(onglets)).toEqual(['Comptoir', 'Articles', 'Approvisionnement']);
  });

  /** Contre-épreuve : `comptable` n'a pas `pieces.fournisseur.lire` (pas dans
   *  `ROLES_LECTURE_FOURNISSEUR_PIECES`) mais a bien `pieces.consigne.lire` — Consignes doit lui
   *  rester visible, seul l'onglet Approvisionnement change de contenu interne (testé plus bas). */
  it('Pièces : un comptable voit Consignes', async () => {
    connecte('comptable');
    rendre('/pieces/articles');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(libelles(onglets)).toEqual(['Comptoir', 'Articles', 'Approvisionnement', 'Consignes']);
  });
});

describe('OngletsDomaine — les vues d’un onglet', () => {
  it('Pointage : cinq vues pour l’encadrement, dont la borne (Journal / Équipe / Clôture, ex-entrées de menu)', async () => {
    connecte('chef_atelier');
    rendre('/pointage/jour');

    const vues = await screen.findByRole('navigation', { name: /vues/i });
    expect(libelles(vues)).toEqual([
      'Mon travail',
      'Journal',
      'Équipe',
      'Clôture de période',
      "Borne d'atelier",
    ]);
    expect(within(vues).getByRole('link', { name: /^journal$/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('technicien : ni Équipe, ni Clôture, ni Borne — les vues d’encadrement disparaissent', async () => {
    connecte('technicien');
    rendre('/pointage/jour');

    const vues = await screen.findByRole('navigation', { name: /vues/i });
    expect(libelles(vues)).toEqual(['Mon travail', 'Journal']);
  });

  /**
   * Changement de design assumé (`navigation-modele.ts`, tête de `ONGLETS_ATELIER` → `depotPneus`) :
   * « Au dépôt » et « À relancer » n'étaient plus deux vues navigables dans le modèle depuis la
   * fusion Lot D — c'étaient deux écrans réels (`EcranHangarPneus` / `EcranJeuxARelancer`) fusionnés
   * en UN SEUL écran à onglets INTERNES (`EcranHangarPneus`, `?onglet=a_relancer`, un paramètre qui
   * n'apparaît jamais dans le pathname). `trouverCorrespondance` résout par pathname : les deux
   * anciennes vues produisaient le même pathname `/pneus`, l'une aurait donc systématiquement volé
   * la surbrillance de l'autre. Le modèle n'expose donc plus AUCUNE vue sur cet onglet — la
   * distinction vit désormais uniquement dans l'écran, hors de cette rangée.
   */
  it('Dépôt pneus : aucune vue — « à relancer » est un onglet interne de l’écran, pas une entrée de menu', async () => {
    connecte('receptionnaire');
    rendre('/pneus');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(within(onglets).getByRole('link', { name: /dépôt pneus/i })).toBeInTheDocument();
    // Aucune seconde rangée : `depotPneus` ne porte plus de `vues` du tout dans le modèle.
    expect(screen.queryByRole('navigation', { name: /vues/i })).toBeNull();
    // Garde-fou anti-régression : si « à relancer » redevenait une entrée de menu (vue ou onglet),
    // ce lien apparaîtrait quelque part dans le document et ferait rougir cette assertion.
    expect(screen.queryByRole('link', { name: /à relancer/i })).not.toBeInTheDocument();
  });

  it('un onglet sans vue ne rend aucune seconde rangée', async () => {
    connecte('chef_atelier');
    rendre('/ordres-reparation');

    await screen.findByRole('navigation', { name: /onglets/i });
    expect(screen.queryByRole('navigation', { name: /vues/i })).toBeNull();
  });

  /**
   * Issue #44 : `pieces.fournisseur.lire`/`pieces.commande_fournisseur.lire`
   * (`apps/api/src/auth/matrice-droits.ts`, `DROITS_PIECES_PAR_ROLE`) ne sont accordés qu'à
   * `direction`/`chef_atelier`/`magasinier`. Un `vendeur` qui ouvre Approvisionnement ne doit
   * proposer QUE « À commander » — avant correctif, « Commandes » et « Fournisseurs » étaient
   * proposés aussi et menaient à un `403` en cul-de-sac.
   */
  it('Approvisionnement : un vendeur ne voit ni Commandes ni Fournisseurs, seulement À commander', async () => {
    connecte('vendeur');
    rendre('/pieces/reapprovisionnement');

    await screen.findByRole('navigation', { name: /onglets/i });
    // Une seule vue visible pour ce rôle (« À commander ») : la rangée de vues ne se rend pas du
    // tout, même règle que « un onglet sans vue » — un choix à une seule option n'en est pas un.
    expect(screen.queryByRole('navigation', { name: /vues/i })).toBeNull();
    // Garde-fou : les deux vues refusées à ce rôle ne doivent apparaître nulle part dans le
    // document, pas seulement être absentes de la rangée de vues.
    expect(screen.queryByRole('link', { name: /^commandes$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^fournisseurs$/i })).not.toBeInTheDocument();
  });

  /**
   * Contre-épreuve du test précédent : un rôle qui a réellement le droit voit les quatre vues.
   * « Factures fournisseurs » ajoutée en dernière vue (droit élargi à `comptable` en plus des trois
   * autres — voir `ROLES_LECTURE_FACTURE_FOURNISSEUR_PIECES`, `navigation-modele.ts`) : un
   * `magasinier` y a droit comme aux deux vues précédentes.
   */
  it('Approvisionnement : un magasinier voit À commander, Commandes, Fournisseurs et Factures fournisseurs', async () => {
    connecte('magasinier');
    rendre('/pieces/reapprovisionnement');

    const vues = await screen.findByRole('navigation', { name: /vues/i });
    expect(libelles(vues)).toEqual([
      'À commander',
      'Commandes',
      'Fournisseurs',
      'Factures fournisseurs',
    ]);
  });
});

describe('OngletsDomaine — quand il ne rend rien', () => {
  it('URL hors arborescence : rien du tout, jamais une rangée vide', async () => {
    connecte('direction');
    const { container } = rendre('/recherche');

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  /** Une rangée à un seul onglet n'offre aucun choix : elle ne ferait que voler 44 px de hauteur.
   *  Cas réel — un technicien sur Facturation ne voit que « Factures » (Relances lui est fermé). */
  it('un seul onglet visible pour le rôle : rien non plus', async () => {
    connecte('technicien');
    const { container } = rendre('/factures');

    await waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('le même écran rend bien la rangée pour un rôle qui a trois onglets (contre-épreuve)', async () => {
    connecte('comptable');
    rendre('/factures');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(libelles(onglets)).toEqual(['Factures', 'Relances', 'Export fiduciaire']);
  });
});

describe('OngletsDomaine — contraintes du produit', () => {
  /**
   * `/pneus` (l'ancien porteur de ce test) ne convient plus : `depotPneus` ne porte plus aucune vue
   * depuis le retrait de « à relancer » (voir le describe ci-dessus), donc aucune rangée de vues ne
   * s'y rend et la moitié « vue » de la garantie n'a plus de support. `/pointage/jour` rend les DEUX
   * rangées en une seule fois — l'onglet Dépôt pneus (aucune vue, pour la moitié « onglet ») et la
   * vue Journal de l'onglet Pointage (pour la moitié « vue ») — donc rien de la garantie d'origine
   * n'est perdu, seul le porteur change.
   */
  it('conserve le site courant de l’URL sur chaque onglet et chaque vue', async () => {
    connecte('chef_atelier');
    rendre('/pointage/jour?site=site-secondaire');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(within(onglets).getByRole('link', { name: /dépôt pneus/i })).toHaveAttribute(
      'href',
      '/pneus?site=site-secondaire',
    );
    const vues = screen.getByRole('navigation', { name: /vues/i });
    expect(within(vues).getByRole('link', { name: /^journal$/i })).toHaveAttribute(
      'href',
      '/pointage/jour?site=site-secondaire',
    );
  });

  /** Régression issue #91 : même correctif que `BarreLaterale.spec.tsx` — l'URL fait toujours foi,
   *  la préférence mémorisée ne comble que son absence. */
  it('reprend la préférence mémorisée de site quand l’URL n’en porte pas', async () => {
    window.localStorage.setItem('dfa.site-courant.tenant-1', 'site-secondaire');
    connecte('chef_atelier');
    rendreAvecPreferenceSite('/pointage/jour');

    const onglets = await screen.findByRole('navigation', { name: /onglets/i });
    expect(within(onglets).getByRole('link', { name: /dépôt pneus/i })).toHaveAttribute(
      'href',
      '/pneus?site=site-secondaire',
    );
    window.localStorage.clear();
  });

  /** Postes de comptoir tactiles (≥ 24 pouces) — §4.6 : plancher de 44 px partout, y compris sur
   *  le troisième niveau, y compris sur desktop. */
  it('cibles tactiles : onglets ET vues font au moins 44 px de haut', async () => {
    connecte('chef_atelier');
    rendre('/pointage/jour');

    await screen.findByRole('navigation', { name: /vues/i });
    for (const lien of screen.getAllByRole('link')) {
      expect(lien.className).toContain('h-[var(--cible-tactile)]');
    }
  });

  /** De vrais liens, jamais un `Tabs` à état local : c'est ce qui rend Ctrl+clic, le bouton
   *  Précédent et une URL partagée cohérents avec ce que montre l'écran. */
  it('les onglets sont des liens, pas des boutons d’onglet à état local', async () => {
    connecte('chef_atelier');
    rendre('/pointage/jour');

    await screen.findByRole('navigation', { name: /onglets/i });
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getAllByRole('link').length).toBeGreaterThan(0);
  });
});
