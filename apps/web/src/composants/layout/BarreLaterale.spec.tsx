import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import type { RoleUtilisateur } from '@dfa/shared';

import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BarreLaterale } from './BarreLaterale';

/**
 * Lot D — le menu à six entrées (`docs/refonte-navigation.md` §4.2). Ces tests verrouillent les
 * trois promesses du lot, dans l'ordre où elles cassent si on les oublie :
 *
 *  1. SIX entrées et pas une de plus, dans un ordre identique pour tous les rôles — c'est ce qui
 *     rend « troisième entrée, sous Atelier » vrai au téléphone quel que soit le compte.
 *  2. Aucune zone défilante — le menu qui défile détruit la mémoire spatiale, et c'est
 *     précisément la régression qu'un futur ajout d'entrée réintroduirait sans bruit.
 *  3. Chaque entrée ouvre sur son PREMIER ONGLET VISIBLE pour le rôle, jamais sur un écran refusé.
 *
 * `SESSION_TEST` porte le rôle `chef_atelier`.
 */
function rendre(routeInitiale: string): RenderResult & { queryClient: QueryClient } {
  const queryClient = creerQueryClientTest();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[routeInitiale]}>
          <BarreLaterale />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

/** Même rendu que `rendre`, sous `FournisseurSiteCourant` — seul moyen d'exercer la préférence de
 *  site mémorisée (`hooks/site/ContexteSiteCourant.tsx`, issue #91), que `BarreLaterale` seule ne
 *  peut pas lire (contexte non fourni hors d'`AppShell.tsx` en usage réel). */
function rendreAvecPreferenceSite(routeInitiale: string): void {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <FournisseurSiteCourant>
          <BarreLaterale />
        </FournisseurSiteCourant>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Même rendu que `rendre` ci-dessus, avec le prop `repli` fourni — c'est ce que fait uniquement
 *  l'`aside` desktop d'`AppShell.tsx` (jamais le tiroir mobile), voir `useRepliBarreLaterale.ts`. */
function rendreAvecRepli(
  routeInitiale: string,
  replie: boolean,
  basculer: () => void = vi.fn(),
): RenderResult & { queryClient: QueryClient } {
  const queryClient = creerQueryClientTest();
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[routeInitiale]}>
          <BarreLaterale repli={{ replie, basculer }} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
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

/** Libellés des entrées dans l'ordre du DOM — la seule façon de prouver l'ORDRE, qu'une simple
 *  série de `getByRole` ne dirait pas. */
function libellesDesEntrees(): string[] {
  return screen
    .getAllByRole('link')
    .map((lien) => lien.textContent?.trim() ?? '')
    .filter((libelle) => libelle !== '');
}

function hrefDuLien(nom: RegExp): string | null {
  return screen.getByRole('link', { name: nom }).getAttribute('href');
}

describe('BarreLaterale — les six entrées', () => {
  it('direction (droits les plus larges) : exactement six entrées + Réglages, dans l’ordre de la journée', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(libellesDesEntrees()).toEqual([
      "Aujourd'hui",
      'Atelier',
      'Clients & véhicules',
      'Pièces',
      'Facturation',
      'Ventes',
      'Réglages',
    ]);
  });

  it('l’ordre ne change pas avec le rôle : un magasinier voit un sous-ensemble, jamais un réarrangement', async () => {
    connecte('magasinier');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    // Pas de Ventes (`ventes.*` fermé au magasinier), mais Atelier reste avant
    // Clients & véhicules, qui reste avant Pièces : l'ordre est absolu, pas relatif au rôle.
    expect(libellesDesEntrees()).toEqual([
      "Aujourd'hui",
      'Atelier',
      'Clients & véhicules',
      'Pièces',
      'Facturation',
      'Réglages',
    ]);
  });

  /**
   * LE CŒUR DU LOT. jsdom ne calcule aucun layout, donc aucun test ne peut mesurer un défilement
   * réel — ce qu'on verrouille ici est la CAUSE structurelle : plus aucune classe `overflow-y-*`
   * dans la barre, et un nombre d'entrées borné. Un futur contributeur qui rajouterait
   * `overflow-y-auto` « par sécurité » (le geste exact qui a produit l'état d'avant le lot) fait
   * rougir ce test au lieu de laisser le menu se remettre à défiler en silence.
   */
  it('aucune zone défilante dans la barre, et jamais plus de sept liens à rendre', async () => {
    connecte('direction');
    const { container } = rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(container.querySelectorAll('[class*="overflow-y"]')).toHaveLength(0);
    expect(screen.getAllByRole('link').length).toBeLessThanOrEqual(7);
  });

  it('Réglages vit dans le pied, séparé des six entrées — jamais dans la même liste', async () => {
    connecte('direction');
    rendre('/');

    const reglages = await screen.findByRole('link', { name: /^réglages$/i });
    const nav = screen.getByRole('navigation');
    const listeDesSix = nav.firstElementChild;
    const pied = nav.lastElementChild;

    expect(listeDesSix).not.toBe(pied);
    expect(listeDesSix?.contains(reglages)).toBe(false);
    expect(pied?.contains(reglages)).toBe(true);
    // Le filet est ce qui encode la frontière entre les plans de travail et ce qu'on configure.
    expect(pied?.className).toContain('border-t');
  });

  it('cibles tactiles : chaque entrée fait au moins 44 px de haut (h-11), postes de comptoir tactiles', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    for (const lien of screen.getAllByRole('link')) {
      expect(lien.className).toContain('h-11');
    }
  });
});

describe('BarreLaterale — où mène chaque entrée', () => {
  it('chaque entrée ouvre sur son premier onglet visible pour le rôle', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    // Fusion accueil/tableau de bord : l'entrée « Aujourd'hui » pointe directement sur
    // `/tableau-bord`, plus sur `/` (qui n'est plus qu'un relais vers cette même page).
    expect(hrefDuLien(/aujourd/i)).toBe('/tableau-bord');
    expect(hrefDuLien(/^atelier$/i)).toBe('/ordres-reparation');
    expect(hrefDuLien(/clients & véhicules/i)).toBe('/clients');
    expect(hrefDuLien(/^pièces$/i)).toBe('/pieces/recherche-comptoir');
    expect(hrefDuLien(/^facturation$/i)).toBe('/factures');
    expect(hrefDuLien(/^ventes$/i)).toBe('/ventes/dossiers');
    expect(hrefDuLien(/^réglages$/i)).toBe('/parametrage/atelier');
  });

  /**
   * §2 : « l'onglet par défaut d'une entrée varie par rôle ». Le technicien qui ouvre Atelier vient
   * pointer, pas lire la liste des OR du garage.
   */
  it('technicien : Atelier ouvre sur Pointage › Mon travail, pas sur la liste des OR', async () => {
    connecte('technicien');
    rendre('/');

    await waitFor(() => expect(hrefDuLien(/^atelier$/i)).toBe('/pointage'));
  });

  /**
   * Le premier onglet visible dépend des droits : un réceptionniste n'a accès qu'à « Tarifs et
   * prestations » dans Réglages, l'entrée l'y emmène donc directement — jamais sur un onglet
   * « Paramètres atelier » qui lui rendrait un refus.
   */
  it('réceptionniste : Réglages ouvre sur Tarifs et prestations, son seul onglet', async () => {
    connecte('receptionnaire');
    rendre('/');

    await waitFor(() => expect(hrefDuLien(/^réglages$/i)).toBe('/parametrage/referentiels'));
  });

  it('comptable : Réglages ouvre sur les coordonnées bancaires (gouvernance atelier fermée)', async () => {
    connecte('comptable');
    rendre('/');

    await waitFor(() => expect(hrefDuLien(/^réglages$/i)).toBe('/parametrage/facturation'));
  });
});

/**
 * Le site actif est lu DEPUIS L'URL, jamais depuis la session — régression d'origine : la barre
 * calculait le site depuis `session.sites.find(actif)` et ramenait silencieusement l'utilisateur
 * sur son site par défaut. L'URL est la source, et rien n'est inventé quand `?site=` est absent.
 */
describe('BarreLaterale — conservation du site courant', () => {
  it('conserve le site de l’URL sur toutes les entrées', async () => {
    connecte('direction');
    rendre('/clients?site=site-secondaire');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(hrefDuLien(/clients & véhicules/i)).toBe('/clients?site=site-secondaire');
    expect(hrefDuLien(/^atelier$/i)).toBe('/ordres-reparation?site=site-secondaire');
    expect(hrefDuLien(/^pièces$/i)).toBe('/pieces/recherche-comptoir?site=site-secondaire');
    // Régression corrigée par le Lot D : « Facturation » pointait `/factures` en chaîne brute et
    // perdait le site, ce qui faisait retomber l'en-tête sur « Tous les sites » sans que
    // l'utilisateur ait changé de site.
    expect(hrefDuLien(/^facturation$/i)).toBe('/factures?site=site-secondaire');
  });

  it('n’invente aucun site quand l’URL n’en porte pas', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(hrefDuLien(/clients & véhicules/i)).toBe('/clients');
    expect(hrefDuLien(/^atelier$/i)).toBe('/ordres-reparation');
  });
});

/**
 * Régression issue #91 (« il oublie mon choix dès que je change d'écran ») : quand l'URL courante
 * ne porte AUCUN `?site=` (parce qu'un écran hors de ce périmètre a construit un lien interne sans
 * le propager), la barre latérale ne retombe plus sur « aucun site » — elle reprend la dernière
 * préférence mémorisée (`hooks/site/ContexteSiteCourant.tsx`, tenant `SESSION_TEST.tenant.id` =
 * `'tenant-1'`). Un `?site=` déjà présent dans l'URL continue de faire foi (test précédent,
 * inchangé) : la préférence ne comble que son absence, jamais ne l'écrase.
 */
describe('BarreLaterale — reprise de la préférence de site (issue #91)', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('reprend la préférence mémorisée quand l’URL n’en porte pas', async () => {
    window.localStorage.setItem('dfa.site-courant.tenant-1', 'site-secondaire');
    connecte('direction');
    rendreAvecPreferenceSite('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(hrefDuLien(/clients & véhicules/i)).toBe('/clients?site=site-secondaire');
    expect(hrefDuLien(/^atelier$/i)).toBe('/ordres-reparation?site=site-secondaire');
  });

  it('l’URL reste prioritaire sur la préférence mémorisée quand les deux sont présents', async () => {
    window.localStorage.setItem('dfa.site-courant.tenant-1', 'site-secondaire');
    connecte('direction');
    rendreAvecPreferenceSite('/clients?site=site-sion');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(hrefDuLien(/clients & véhicules/i)).toBe('/clients?site=site-sion');
  });
});

/**
 * `aria-current="page"` vient de l'état RÉSOLU du modèle (`trouverCorrespondance`), pas du
 * `isActive` de `NavLink` : une fiche ou une vue doit garder son entrée surlignée, alors que
 * `NavLink` ne compare que l'URL au `to` du lien.
 */
describe('BarreLaterale — entrée active', () => {
  it('surligne Clients & véhicules sur une fiche client, dont l’URL ne vaut pas le `to` du lien', async () => {
    connecte('direction');
    rendre('/clients/42');

    const actif = await screen.findByRole('link', { name: /clients & véhicules/i });
    expect(actif).toHaveAttribute('aria-current', 'page');
    // `findByRole`, pas `getByRole` : depuis le correctif de l'issue #46 (`ordresReparation` porte
    // désormais `roles: ROLES_LECTURE_OR`), Atelier est une entrée GOUVERNÉE comme les autres —
    // elle n'apparaît plus forcément dans le même tick que « Clients & véhicules » (restée, elle,
    // sans restriction). Attendre son apparition, pas seulement son état une fois affichée.
    expect(await screen.findByRole('link', { name: /^atelier$/i })).not.toHaveAttribute(
      'aria-current',
    );
  });

  /**
   * NE PROVIENT PAS DE L'ARBITRAGE DE NAVIGATION. Ce test reste EN ROUGE après vérification, et
   * pas à cause d'un modèle abandonné : `navigation-modele.ts` résout correctement
   * `trouverCorrespondance('/pointage/equipe') → { entree: 'atelier', … }` (vérifié isolément), et
   * `actif` dans `BarreLaterale.tsx` vaut donc bien `true` pour l'entrée Atelier au moment du rendu
   * (la classe `bg-primary` est posée). Le défaut est dans la façon dont `aria-current` est confié à
   * `<NavLink>` : react-router détruit le prop `aria-current` en `ariaCurrentProp` (défaut `"page"`)
   * et ne le RESTITUE que si son PROPRE `isActive` (comparaison `to` / `location.pathname`, indépendante
   * de ce composant) est vrai — voir `NavLinkWithRef` dans
   * `react-router/dist/development/chunk-G5KIBF6U.js` (« let ariaCurrent = isActive ? ariaCurrentProp
   * : void 0 »). Ici `to` vaut `/ordres-reparation` (premier onglet visible, onglet PAR DÉFAUT de
   * l'entrée, pas l'onglet courant), donc `isActive` de `NavLink` est `false` sur
   * `/pointage/equipe` quelle que soit la valeur passée à `aria-current` — `'page'` ou `undefined`
   * aboutissent au MÊME rendu (`undefined` retombe sur le défaut `"page"` du destructuring, qui est
   * de toute façon ignoré par le `isActive ? … : void 0` qui suit). Reproduit isolément avec un
   * `<NavLink to="/ordres-reparation" aria-current="page">` nu dans un `MemoryRouter` sur
   * `/pointage/equipe` : `aria-current` n'apparaît jamais dans le DOM.
   *
   * `OngletsDomaine.tsx` porte le même idiome mais n'est pas exposé au même défaut : son `to` est
   * TOUJOURS le chemin propre de l'onglet/vue qu'on est en train de rendre (pas un onglet par
   * défaut), donc le `isActive` propre à `NavLink` coïncide par construction avec `actif` — masquant
   * le même bug plutôt que le corrigeant. `BarreLaterale.tsx` diffère structurellement : `to` est le
   * chemin de l'onglet PAR DÉFAUT de l'entrée, qui n'a aucune raison de préfixer l'URL courante dès
   * que l'onglet actif n'est pas cet onglet par défaut (ex. chef_atelier sur Pointage, dont
   * `/pointage/equipe` ne préfixe jamais `/ordres-reparation`).
   *
   * Correction hors du périmètre d'écriture de ce fichier (`composants/layout/BarreLaterale.tsx` est
   * explicitement interdit à l'agent qui a produit cette correction) : il faut soit rendre un `<a>`
   * (ou `<Link>`) et poser `aria-current` soi-même sans passer par le prop géré de `NavLink`, soit
   * une autre voie côté composant. Gardé EN ROUGE volontairement plutôt que rendu vert en affaiblissant
   * l'assertion ou en choisissant un rôle/route qui ferait coïncider `to` et le pathname par
   * accident (ex. `technicien`, dont l'onglet par défaut d'Atelier EST déjà Pointage) — un tel
   * choix cesserait de prouver que la logique `actif`/`idEntreeActive` fonctionne réellement et
   * masquerait la régression au lieu de la révéler.
   */
  it('surligne Atelier depuis une vue de pointage (`/pointage/equipe`), pas seulement depuis `/pointage`', async () => {
    connecte('chef_atelier');
    rendre('/pointage/equipe');

    const actif = await screen.findByRole('link', { name: /^atelier$/i });
    expect(actif).toHaveAttribute('aria-current', 'page');
  });

  it('n’en surligne aucune sur une URL hors arborescence (`/recherche`)', async () => {
    connecte('direction');
    rendre('/recherche');

    await screen.findByRole('link', { name: /^pièces$/i });
    for (const lien of screen.getAllByRole('link')) {
      expect(lien).not.toHaveAttribute('aria-current');
    }
  });
});

/**
 * MASQUAGE PAR RÔLE — une entrée n'existe que si au moins un de ses onglets est ouvert au rôle,
 * donc aucune entrée ne peut ouvrir sur un contenu vide. La distinction « protection réelle » /
 * « confort de menu » reste celle documentée dans `routes/droits-routes.ts` : masquer ici ne
 * protège rien, l'API est l'arbitre.
 */
describe('BarreLaterale — masquage par rôle', () => {
  /**
   * DÉCISION DU LOT D (RF-115). `facturation.document.lire` EST accordé à `admin` côté API — ce
   * masquage est donc de l'ergonomie, pas de la sécurité, et il ne doit surtout pas devenir une
   * garde de route. Motif : `EcranListeFactures` retire structurellement les colonnes montant,
   * statut et retard pour un rôle sans droit financier ; proposer à `admin` une entrée qui ouvre
   * une liste sans un seul montant annonce un contenu qu'il ne verra jamais. Jusqu'ici le lien
   * `/factures` était le SEUL du menu sans aucune garde de rôle.
   */
  it('admin : aucune entrée Facturation (RF-115), ni Pièces, ni Ventes', async () => {
    connecte('admin');
    rendre('/');

    await screen.findByRole('link', { name: /^atelier$/i });

    expect(screen.queryByRole('link', { name: /^facturation$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^pièces$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^ventes$/i })).not.toBeInTheDocument();
    // Il garde en revanche Réglages : la gouvernance atelier lui est ouverte.
    expect(screen.getByRole('link', { name: /^réglages$/i })).toBeInTheDocument();
  });

  /**
   * Le comptable est le contre-exemple utile d'`admin` : mêmes six entrées visibles (il porte
   * `pieces.*` et `ventes.*` en lecture), Facturation comprise — la seule différence entre les
   * deux rôles est financière, et c'est exactement ce que le masquage d'`admin` encode.
   */
  it('comptable : voit les six entrées, Facturation en tête de son travail', async () => {
    connecte('comptable');
    rendre('/');

    expect(await screen.findByRole('link', { name: /^facturation$/i })).toHaveAttribute(
      'href',
      '/factures',
    );
    expect(libellesDesEntrees()).toEqual([
      "Aujourd'hui",
      'Atelier',
      'Clients & véhicules',
      'Pièces',
      'Facturation',
      'Ventes',
      'Réglages',
    ]);
  });

  it('technicien : ni Facturation masquée (il lit la facture de son OR) ni Ventes (fermées)', async () => {
    connecte('technicien');
    rendre('/');

    expect(await screen.findByRole('link', { name: /^facturation$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^ventes$/i })).not.toBeInTheDocument();
  });

  /**
   * `poste_atelier` est un APPAREIL, pas un employé (§2, « aucun menu, aucun en-tête, aucune
   * recherche »). Filtrer entrée par entrée aurait laissé passer celles sans restriction de rôle
   * (Clients & véhicules) et remis un menu sur une tablette murale.
   */
  it('poste_atelier (borne murale) : aucune entrée du tout', async () => {
    connecte('poste_atelier');
    rendre('/pointage/borne');

    await waitFor(() => {
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
  });

  /**
   * Session non encore résolue : les entrées SANS restriction de rôle s'affichent, les entrées
   * gouvernées apparaissent ensuite — jamais l'inverse. Le menu s'enrichit, il ne clignote pas.
   *
   * CORRECTIF issue #46 : `Atelier` a rejoint les entrées GOUVERNÉES (ses trois onglets —
   * Ordres de réparation, Pointage, Dépôt pneus — portent désormais tous une restriction de rôle ;
   * `ordresReparation` ne fait plus exception, `vendeur` n'a pas `atelier.or.lire`). Elle
   * n'apparaît donc plus AVANT la résolution de la session, comme `Pièces` : c'est le prix correct
   * d'un menu qui ne propose plus une destination qui martelait un 403 permanent pour `vendeur`.
   */
  it('sans session : les entrées gouvernées restent absentes, les autres sont déjà là', async () => {
    rendre('/');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /^pièces$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /^atelier$/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /clients & véhicules/i })).toBeInTheDocument();
    // Réglages reste proposé : « Tarifs et prestations » est ouvert à tout rôle authentifié
    // (outil de comptoir — voir droits-routes.ts, l'absence de restriction EST la décision).
    expect(screen.getByRole('link', { name: /^réglages$/i })).toBeInTheDocument();
  });
});

/**
 * REPLI DESKTOP (demande @laupernoe, revue webui du 10.08.2026) — un bouton réduit la colonne aux
 * icônes seules. Deux promesses testées, dans l'ordre du brief : rien ne casse quand `repli` est
 * fourni mais déplié (c'est ce que fait l'`aside` d'`AppShell.tsx` par défaut, avant tout clic), et
 * le nom accessible de chaque entrée survit au repli — l'icône seule est `aria-hidden`, c'est
 * `aria-label` qui porte le nom, pas le texte visible qui disparaît (`sr-only`).
 */
describe('BarreLaterale — repli desktop', () => {
  it('repliée : les six entrées + Réglages gardent un nom accessible malgré l’icône seule', async () => {
    connecte('direction');
    rendreAvecRepli('/', true);

    // Attendre une entrée GOUVERNÉE avant d'interroger le reste : `direction` a droit à tout, donc
    // Pièces/Facturation/Ventes/Atelier apparaissent tous au même tick une fois la session résolue
    // (depuis le correctif de l'issue #46, Atelier EST gouvernée elle aussi — voir
    // `navigation-modele.ts`, `ROLES_LECTURE_OR`) — un `getAllByRole` avant cette résolution
    // aurait compté un menu encore partiel.
    const pieces = await screen.findByRole('link', { name: /^pièces$/i });
    expect(pieces).toHaveAccessibleName('Pièces');
    const atelier = screen.getByRole('link', { name: /^atelier$/i });
    expect(atelier).toHaveAccessibleName('Atelier');
    // Sept liens (six entrées + Réglages), chacun nommé — pas un seul lien muet une fois l'icône
    // seule affichée.
    const liens = screen.getAllByRole('link');
    expect(liens).toHaveLength(7);
    for (const lien of liens) {
      expect(lien.getAttribute('aria-label')).not.toBe('');
    }
  });

  it('dépliée (prop `repli` fourni, `replie: false`) : rien ne change de ce qui passait déjà sans repli', async () => {
    connecte('direction');
    rendreAvecRepli('/', false);

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(libellesDesEntrees()).toEqual([
      "Aujourd'hui",
      'Atelier',
      'Clients & véhicules',
      'Pièces',
      'Facturation',
      'Ventes',
      'Réglages',
    ]);
    // Déplié, le libellé reste un texte normal (pas `sr-only`) — repli fourni ou non ne doit rien
    // changer au rendu déplié.
    expect(screen.getByRole('link', { name: /^atelier$/i }).querySelector('span')).not.toHaveClass(
      'sr-only',
    );
  });

  it('la pilule active (aria-current + fond de marque) reste posée sur l’entrée repliée', async () => {
    connecte('direction');
    rendreAvecRepli('/clients/42', true);

    const actif = await screen.findByRole('link', { name: /clients & véhicules/i });
    expect(actif).toHaveAttribute('aria-current', 'page');
    expect(actif.className).toContain('bg-primary');
    expect(actif.className).toContain('text-primary-foreground');
  });

  it('le bouton de repli annonce son état via `aria-expanded` et appelle `basculer` au clic', async () => {
    connecte('direction');
    const basculer = vi.fn();
    const utilisateur = userEvent.setup();
    rendreAvecRepli('/', false, basculer);

    const boutonReduire = await screen.findByRole('button', {
      name: 'Réduire la barre latérale',
    });
    expect(boutonReduire).toHaveAttribute('aria-expanded', 'true');

    await utilisateur.click(boutonReduire);
    expect(basculer).toHaveBeenCalledOnce();
  });

  it('repliée, le bouton propose « Agrandir » — jamais « Réduire » une seconde fois', async () => {
    connecte('direction');
    rendreAvecRepli('/', true);

    expect(
      await screen.findByRole('button', { name: 'Agrandir la barre latérale' }),
    ).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('button', { name: 'Réduire la barre latérale' }),
    ).not.toBeInTheDocument();
  });

  it('sans prop `repli` (tiroir mobile) : aucun bouton de repli n’est rendu', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^atelier$/i });
    expect(screen.queryByRole('button', { name: /barre latérale/i })).not.toBeInTheDocument();
  });
});

/**
 * Numéro de version (demande @laupernoe, 17.08.2026) — collé au bouton Réglages, jamais un pied de page
 * détaché (précision explicite après une première implémentation ailleurs). Injecté par
 * `vite.config.ts` (`define`) dans `import.meta.env.VITE_DFA_VERSION_INFO`, une config SÉPARÉE de
 * `vitest.config.ts` qui ne porte pas ce `define` : ces tests stubbent donc explicitement la
 * valeur (`vi.stubEnv`, qui met aussi à jour `import.meta.env` sous Vitest) plutôt que de dépendre
 * d'un état par défaut.
 */
describe('BarreLaterale — numéro de version, collé à Réglages', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('affiche la version telle qu’injectée à la compilation, dans le même pied que Réglages', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('direction');
    rendre('/');

    const reglages = await screen.findByRole('link', { name: /^réglages$/i });
    const version = screen.getByText('0.1.0+a1b2c3d');
    const nav = screen.getByRole('navigation');
    const pied = nav.lastElementChild;

    // Même conteneur que le lien Réglages, pas un pied détaché.
    expect(pied?.contains(reglages)).toBe(true);
    expect(pied?.contains(version)).toBe(true);
    // Sélectionnable à la souris (copier-coller) : jamais `select-none`.
    expect(version.className).toContain('select-text');
    expect(version.className).not.toContain('select-none');
    expect(version).toHaveAttribute('title', 'Version 0.1.0+a1b2c3d');
  });

  it('affiche le marqueur « +modifié » quand l’arbre était sale au moment du build', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d+modifié');
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^réglages$/i });
    expect(screen.getByText('0.1.0+a1b2c3d+modifié')).toBeInTheDocument();
  });

  it('retombe sur « inconnue » (traduit) quand l’information n’est pas disponible — jamais une chaîne vide ni une exception', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', undefined);
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^réglages$/i });
    expect(screen.getByText('inconnue')).toBeInTheDocument();
  });

  it('repliée : le texte de version est masqué entièrement (jamais tronqué), Réglages reste accessible en icône', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('direction');
    rendreAvecRepli('/', true);

    const reglages = await screen.findByRole('link', { name: /^réglages$/i });
    expect(reglages).toBeInTheDocument();
    const version = screen.getByText('0.1.0+a1b2c3d');
    expect(version.className).toContain('hidden');
  });

  it('déplié (repli fourni, `replie: false`) : le texte de version reste visible, comme sans prop `repli`', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('direction');
    rendreAvecRepli('/', false);

    await screen.findByRole('link', { name: /^réglages$/i });
    const version = screen.getByText('0.1.0+a1b2c3d');
    expect(version.className).not.toContain('hidden');
  });

  it('poste_atelier (borne murale) : ni Réglages ni version — la colonne entière est absente (assumé)', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('poste_atelier');
    rendre('/pointage/borne');

    await waitFor(() => {
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('0.1.0+a1b2c3d')).not.toBeInTheDocument();
  });
});
