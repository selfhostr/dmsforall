import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within, type RenderResult } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import type { RoleUtilisateur } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
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

    expect(hrefDuLien(/aujourd/i)).toBe('/');
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
    expect(screen.getByRole('link', { name: /^atelier$/i })).not.toHaveAttribute('aria-current');
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
   * (Clients & véhicules, Ordres de réparation) et remis un menu sur une tablette murale.
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
   */
  it('sans session : les entrées gouvernées restent absentes, les autres sont déjà là', async () => {
    rendre('/');

    await waitFor(() => {
      expect(screen.queryByRole('link', { name: /^pièces$/i })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /^atelier$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /clients & véhicules/i })).toBeInTheDocument();
    // Réglages reste proposé : « Tarifs et prestations » est ouvert à tout rôle authentifié
    // (outil de comptoir — voir droits-routes.ts, l'absence de restriction EST la décision).
    expect(screen.getByRole('link', { name: /^réglages$/i })).toBeInTheDocument();
  });
});

/**
 * Numéro de version (support téléphonique) — repris tel quel d'avant le Lot D. Format demandé par
 * @laupernoe : « branche · version » (ex. « main · 0.1.234 »), le point médian étant le seul séparateur.
 * AUCUN état de chargement/erreur ne doit produire de texte (exception assumée à la règle
 * « chargement / vide / erreur », voir le commentaire dans `BarreLaterale.tsx`).
 */
describe('BarreLaterale — numéro de version', () => {
  it('affiche « branche · version » une fois la sonde de vie résolue', async () => {
    server.use(
      http.get('/api/v1/sante', () =>
        HttpResponse.json({ statut: 'ok', version: '3.4.5-verif', branche: 'main' }),
      ),
    );
    rendre('/');

    expect(await screen.findByText('main · 3.4.5-verif')).toBeInTheDocument();
  });

  it('n’affiche aucun texte de version tant que la sonde de vie n’a pas répondu (pas de squelette, pas de placeholder)', async () => {
    server.use(
      http.get('/api/v1/sante', async () => {
        // Ne se résout jamais pendant la durée du test : la requête reste `isPending` à coup sûr,
        // ce qui prouve que l'absence de texte observée ci-dessous vient bien de cet état-là (et
        // non d'une simple coïncidence de timing).
        await delay('infinite');
        return HttpResponse.json({ statut: 'ok', version: 'jamais-affichee', branche: 'jamais' });
      }),
    );
    const { queryClient } = rendre('/');

    await waitFor(() => {
      expect(queryClient.getQueryState(clesQuery.sante.version())?.status).toBe('pending');
    });
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  it('n’affiche aucun texte de version quand la sonde de vie échoue (pas de message d’erreur)', async () => {
    server.use(
      http.get('/api/v1/sante', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-3',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const { queryClient } = rendre('/');

    await waitFor(() => {
      expect(queryClient.getQueryState(clesQuery.sante.version())?.status).toBe('error');
    });
    expect(screen.queryByText(/·/)).not.toBeInTheDocument();
  });

  /**
   * Le pied (Réglages + version) vit dans un conteneur FRÈRE de la liste des six entrées, jamais
   * un DESCENDANT — c'est cette séparation structurelle qui garde le filet et le pied ancrés en
   * bas de colonne quelle que soit la hauteur disponible. jsdom ne calculant aucun layout, c'est
   * la seule forme de preuve disponible ici (le rendu visuel, lui, se vérifie au navigateur).
   */
  it('le pied de version reste hors de la liste des six entrées, jamais un descendant', async () => {
    connecte('direction');
    server.use(
      http.get('/api/v1/sante', () =>
        HttpResponse.json({ statut: 'ok', version: '9.9.9-pied', branche: 'main' }),
      ),
    );
    rendre('/');

    const pied = await screen.findByText('main · 9.9.9-pied');
    const nav = screen.getByRole('navigation');
    const listeDesSix = nav.firstElementChild;
    const zonePied = nav.lastElementChild;

    expect(listeDesSix).not.toBeNull();
    expect(listeDesSix).not.toBe(zonePied);
    expect(listeDesSix?.contains(pied)).toBe(false);
    expect(zonePied?.contains(pied)).toBe(true);
    // Les six entrées sont bien dans la liste, et elles sont six.
    expect(within(listeDesSix as HTMLElement).getAllByRole('link')).toHaveLength(6);
  });
});
