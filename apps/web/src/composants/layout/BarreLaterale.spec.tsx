import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import type { RoleUtilisateur } from '@dfa/shared';

import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { reinitialiserEtatAssistant, useEtatAssistant } from '@/hooks/assistant/etat-assistant';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerSessionTest } from '@/test/session';
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
 * Lot « cadre applicatif » (19.08.2026) — TROIS groupes de tests EN PLUS, à la fin du fichier :
 * le bloc tenant en tête de colonne, le pied compte (identité + Réglages + déconnexion, regroupés
 * dans un menu qui se déplie — Réglages n'est donc plus un `role=link` direct, voir la doc de tête
 * de `BarreLaterale.tsx` §2), et leur rendu repliée. Le SITE et le THÈME, qui vivaient dans ces
 * deux blocs, ont déménagé vers `BarreOutilsSuperieure.tsx` au lot « bandeau haut » (26.08.2026) —
 * leurs tests vivent désormais dans `BarreOutilsSuperieure.spec.tsx`.
 *
 * `SESSION_TEST` porte le rôle `chef_atelier`.
 */
const { mutateMock } = vi.hoisted(() => ({ mutateMock: vi.fn() }));
vi.mock('@/hooks/useDeconnexion', () => ({
  useDeconnexion: () => ({ mutate: mutateMock, isPending: false }),
}));

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
 *  série de `getByRole` ne dirait pas. Réglages n'est PLUS un `role=link` direct (Lot « cadre
 *  applicatif » : regroupé dans le menu du pied compte) — cette liste ne porte donc plus que les
 *  six entrées. */
/** Liens des SIX entrées du menu : « Réglages », lien de pied de barre, n'en fait pas partie. */
function liensDesSixEntrees(): HTMLElement[] {
  return screen.getAllByRole('link').filter((lien) => lien.textContent?.trim() !== 'Réglages');
}

function libellesDesEntrees(): string[] {
  return liensDesSixEntrees()
    .map((lien) => lien.textContent?.trim() ?? '')
    .filter((libelle) => libelle !== '');
}

function hrefDuLien(nom: RegExp): string | null {
  return screen.getByRole('link', { name: nom }).getAttribute('href');
}

/** Ouvre le menu du pied compte — déclencheur nommé par prénom + nom + rôle (voir la doc de tête
 *  de `BarreLaterale.tsx`, § pied compte). `Jean Dupont` est l'identité de `SESSION_TEST`. */
async function ouvrirMenuCompte(): Promise<void> {
  const utilisateur = userEvent.setup();
  // `findByRole` (pas `getByRole`) : le pied compte n'existe qu'une fois `session` résolue
  // (requête MSW asynchrone) — voir la doc de tête de `BarreLaterale.tsx`, § pied compte.
  const declencheur = await screen.findByRole('button', { name: /jean dupont/i });
  await utilisateur.click(declencheur);
}

beforeEach(() => {
  mutateMock.mockClear();
});

describe('BarreLaterale — les six entrées', () => {
  it('direction (droits les plus larges) : exactement six entrées, dans l’ordre de la journée', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(libellesDesEntrees()).toEqual([
      "Aujourd'hui",
      'Atelier',
      'Clients & véhicules',
      'Pièces',
      'Facturation',
      'Véhicules à vendre',
    ]);
  });

  it('l’ordre ne change pas avec le rôle : un magasinier voit un sous-ensemble, jamais un réarrangement', async () => {
    connecte('magasinier');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    // Atelier reste avant Clients & véhicules, qui reste avant Pièces : l'ordre est absolu, pas
    // relatif au rôle. Ventes apparaît : la grille (Pièces : Faire) ouvre `ventes.dossier.lire`.
    expect(libellesDesEntrees()).toEqual([
      "Aujourd'hui",
      'Atelier',
      'Clients & véhicules',
      'Pièces',
      'Facturation',
      'Véhicules à vendre',
    ]);
  });

  /**
   * LE CŒUR DU LOT. jsdom ne calcule aucun layout, donc aucun test ne peut mesurer un défilement
   * réel — ce qu'on verrouille ici est la CAUSE structurelle : plus aucune classe `overflow-y-*`
   * dans la barre, et un nombre d'entrées borné. Un futur contributeur qui rajouterait
   * `overflow-y-auto` « par sécurité » (le geste exact qui a produit l'état d'avant le lot) fait
   * rougir ce test au lieu de laisser le menu se remettre à défiler en silence.
   */
  it('aucune zone défilante dans la barre, et jamais plus de six liens de menu à rendre', async () => {
    connecte('direction');
    const { container } = rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });

    expect(container.querySelectorAll('[class*="overflow-y"]')).toHaveLength(0);
    expect(liensDesSixEntrees().length).toBeLessThanOrEqual(6);
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
    expect(hrefDuLien(/^véhicules à vendre$/i)).toBe('/ventes/dossiers');
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
   * Réglages a rejoint le menu du pied compte (Lot « cadre applicatif ») : sa cible dépend TOUJOURS
   * du premier onglet visible pour le rôle, exactement comme avant — seule la façon de l'atteindre
   * a changé (ouvrir le menu, puis cliquer l'entrée du menu plutôt qu'un lien direct de la barre).
   */
  it('réceptionniste : le menu du pied ouvre Réglages sur Tarifs et prestations, son seul onglet', async () => {
    connecte('receptionnaire');
    rendre('/');

    await ouvrirMenuCompte();
    const reglages = await screen.findByRole('menuitem', { name: /réglages/i });
    expect(reglages.getAttribute('href')).toBe('/parametrage/referentiels');
  });

  it('direction : Réglages vit dans le menu du compte, il n’y a plus de lien direct dans la barre', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });
    expect(screen.queryByRole('link', { name: /réglages/i })).not.toBeInTheDocument();

    await ouvrirMenuCompte();
    const reglages = await screen.findByRole('menuitem', { name: /réglages/i });
    // « Mon garage » est le premier onglet de Réglages : c'est lui qui s'ouvre.
    expect(reglages.getAttribute('href')).toBe('/parametrage/garage');
  });

  it('repliée : Réglages reste atteignable par le menu du compte (avatar)', async () => {
    connecte('direction');
    rendreAvecRepli('/', true);

    expect(screen.queryByRole('link', { name: /réglages/i })).not.toBeInTheDocument();
    await ouvrirMenuCompte();
    expect(await screen.findByRole('menuitem', { name: /réglages/i })).toBeInTheDocument();
  });

  it('comptable : le menu du pied ouvre Réglages sur Mon garage (gouvernance atelier fermée)', async () => {
    connecte('comptable');
    rendre('/');

    await ouvrirMenuCompte();
    const reglages = await screen.findByRole('menuitem', { name: /réglages/i });
    expect(reglages.getAttribute('href')).toBe('/parametrage/garage');
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
  it('admin : ni Pièces, ni Ventes (les montants restent fermés)', async () => {
    connecte('admin');
    rendre('/');

    await screen.findByRole('link', { name: /^atelier$/i });

    // Facturation : `facturation.document.lire` lui est accordé via « Encadrer » (grille) ; le menu
    // suit le serveur. Les montants restent masqués (`facturation.paiement.lire` absent).
    expect(screen.queryByRole('link', { name: /^pièces$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^véhicules à vendre$/i })).not.toBeInTheDocument();
    // Il garde en revanche Réglages : la gouvernance atelier lui est ouverte — vérifié dans le
    // menu du pied compte, où Réglages vit désormais (Lot « cadre applicatif »).
    await ouvrirMenuCompte();
    expect(await screen.findByRole('menuitem', { name: /réglages/i })).toBeInTheDocument();
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
      'Véhicules à vendre',
    ]);
  });

  it('technicien : ni Facturation masquée (il lit la facture de son OR) ni Ventes (fermées)', async () => {
    connecte('technicien');
    rendre('/');

    expect(await screen.findByRole('link', { name: /^facturation$/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^véhicules à vendre$/i })).not.toBeInTheDocument();
  });

  /**
   * `poste_atelier` est un APPAREIL, pas un employé (§2, « aucun menu, aucun en-tête, aucune
   * recherche »). Filtrer entrée par entrée aurait laissé passer celles sans restriction de rôle
   * (Clients & véhicules) et remis un menu sur une tablette murale. Cette garantie-là appartient à
   * `AppShell.tsx`, qui retire la colonne ENTIÈRE pour ce rôle (`afficheNavigation`) — ce test-ci
   * prouve seulement que `BarreLaterale`, prise isolément, ne rend elle-même AUCUNE des six
   * entrées pour ce rôle (le reste — bloc tenant/site, pied compte — n'est pas gouverné par ce
   * composant, voir la description du pied compte plus bas dans ce fichier).
   */
  it('poste_atelier (borne murale) : aucune des six entrées', async () => {
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
    // Sans session résolue, ni le bloc tenant/site ni le pied compte ne se rendent (les deux
    // attendent `session`, voir la doc de `BarreLaterale.tsx`) — rien à affirmer de faux.
    expect(screen.queryByRole('button', { name: /jean dupont/i })).not.toBeInTheDocument();
  });
});

/**
 * REPLI DESKTOP (demande produit, revue webui du 10.08.2026) — un bouton réduit la colonne aux
 * icônes seules. Deux promesses testées, dans l'ordre du brief : rien ne casse quand `repli` est
 * fourni mais déplié (c'est ce que fait l'`aside` d'`AppShell.tsx` par défaut, avant tout clic), et
 * le nom accessible de chaque entrée survit au repli — l'icône seule est `aria-hidden`, c'est
 * `aria-label` qui porte le nom, pas le texte visible qui disparaît (`sr-only`).
 */
describe('BarreLaterale — repli desktop', () => {
  it('repliée : les six entrées gardent un nom accessible malgré l’icône seule', async () => {
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
    // Six liens, chacun nommé — pas un seul lien muet une fois l'icône seule affichée.
    const liens = liensDesSixEntrees();
    expect(liens).toHaveLength(6);
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
      'Véhicules à vendre',
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

  it('sans prop `repli` (tiroir mobile) : aucun bouton de repli n’est rendu, le tenant reste affiché', async () => {
    connecte('direction');
    rendre('/');

    await screen.findByRole('link', { name: /^atelier$/i });
    expect(screen.queryByRole('button', { name: /barre latérale/i })).not.toBeInTheDocument();
    expect(screen.getByText('Garage Test SA')).toBeInTheDocument();
  });
});

/**
 * Numéro de version (demande produit, 17.08.2026) — collé au pied compte, jamais un pied de page
 * détaché (précision explicite après une première implémentation ailleurs). Injecté par
 * `vite.config.ts` (`define`) dans `import.meta.env.VITE_DFA_VERSION_INFO`, une config SÉPARÉE de
 * `vitest.config.ts` qui ne porte pas ce `define` : ces tests stubbent donc explicitement la
 * valeur (`vi.stubEnv`, qui met aussi à jour `import.meta.env` sous Vitest) plutôt que de dépendre
 * d'un état par défaut.
 *
 * DÉCOUPLÉ de `reglagesVisibles(role)` depuis le Lot « cadre applicatif » (voir la doc de tête de
 * `BarreLaterale.tsx`, § pied compte) — la version reste affichée pour TOUT rôle qui monte
 * réellement cette colonne, que Réglages lui soit ouvert ou non.
 */
describe('BarreLaterale — numéro de version, collé au pied compte', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('affiche la version telle qu’injectée à la compilation, dans le même pied que le compte', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('direction');
    rendre('/');

    const compte = await screen.findByRole('button', { name: /jean dupont/i });
    const version = screen.getByText('v0.1.0');
    // Même pied que le déclencheur du compte, pas un pied détaché — ancré sur `.border-t`
    // (le filet qui délimite VISUELLEMENT le pied compte, `BarreLaterale.tsx`) plutôt que sur
    // `closest('div')` : le déclencheur est nichée sous un `div` de mise en page intermédiaire
    // (`min-w-0`, contrainte de troncature) — un `div` intermédiaire légitime, pas un pied détaché.
    // `closest('.border-t')` reste vrai quelle que soit la profondeur de nichage interne, tant que
    // la version reste dans LE pied compte.
    expect(compte.closest('.border-t')?.contains(version)).toBe(true);
    // Sélectionnable à la souris (copier-coller) : jamais `select-none`.
    expect(version.className).toContain('select-text');
    expect(version.className).not.toContain('select-none');
    expect(version).toHaveAttribute('title', 'Version 0.1.0+a1b2c3d');
  });

  it('format court « v0.1.0 » : hash et marqueur « +modifié » réservés à l’infobulle', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d+modifié');
    connecte('direction');
    rendre('/');

    await screen.findByRole('button', { name: /jean dupont/i });
    // Affichage court « v0.1.0 » ; hash et marqueur restent dans l'infobulle, pour le support.
    expect(screen.getByText('v0.1.0')).toHaveAttribute('title', 'Version 0.1.0+a1b2c3d+modifié');
  });

  it('version indisponible : aucune ligne « inconnue » n’est affichée', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', undefined);
    connecte('direction');
    rendre('/');

    await screen.findByRole('button', { name: /jean dupont/i });
    expect(screen.queryByText(/inconnu/i)).not.toBeInTheDocument();
    expect(document.querySelector('[title^="Version"]')).toBeNull();
  });

  it('repliée : le texte de version est masqué entièrement (jamais tronqué), le pied compte reste accessible en icône', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('direction');
    rendreAvecRepli('/', true);

    const compte = await screen.findByRole('button', { name: /jean dupont/i });
    expect(compte).toBeInTheDocument();
    const version = screen.getByText('v0.1.0');
    expect(version.className).toContain('hidden');
  });

  it('déplié (repli fourni, `replie: false`) : le texte de version reste visible, comme sans prop `repli`', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('direction');
    rendreAvecRepli('/', false);

    await screen.findByRole('button', { name: /jean dupont/i });
    const version = screen.getByText('v0.1.0');
    expect(version.className).not.toContain('hidden');
  });

  /**
   * Poste_atelier n'apparaît JAMAIS dans ce scénario en usage réel (`AppShell.tsx` retire l'`aside`
   * entier pour ce rôle) — mais `BarreLaterale`, prise isolément, ne connaît pas cette règle : sa
   * seule responsabilité est de ne jamais faire disparaître la version/la déconnexion pour une
   * raison qui n'a rien à voir avec elles (voir le commentaire du Lot « cadre applicatif » sur le
   * découplage d'avec `reglagesVisibles`). Réglages, en revanche, reste absent du menu pour ce
   * rôle — c'est la seule chose que ce rôle ferme réellement ici.
   */
  it('poste_atelier : la version et la déconnexion restent affichées, Réglages seul disparaît du menu', async () => {
    vi.stubEnv('VITE_DFA_VERSION_INFO', '0.1.0+a1b2c3d');
    connecte('poste_atelier');
    rendre('/pointage/borne');

    await waitFor(() => {
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
    expect(screen.getByText('v0.1.0')).toBeInTheDocument();

    await ouvrirMenuCompte();
    expect(screen.queryByRole('menuitem', { name: /réglages/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /se déconnecter/i })).toBeInTheDocument();
  });
});

/**
 * BLOC TENANT — Lot « cadre applicatif » (19.08.2026), en tête de colonne, à la place de l'ancien
 * mot-symbole « dmsforall » (voir la doc de tête du fichier, §1). Le SITE, qui vivait dans ce même
 * bloc, a déménagé vers `BarreOutilsSuperieure.tsx` au lot « bandeau haut » (26.08.2026) — ses
 * tests (rendu à un site, multi-site, code court replié, « Tous les sites »/« Aucun site choisi »)
 * vivent désormais dans `BarreOutilsSuperieure.spec.tsx` et `SelecteurSiteEntete.spec.tsx`.
 */
describe('BarreLaterale — bloc tenant', () => {
  it('affiche le nom du tenant, jamais le mot-symbole du produit', async () => {
    connecte('direction');
    rendre('/?site=site-1');

    expect(await screen.findByText('Garage Test SA')).toBeInTheDocument();
    expect(screen.queryByText('dmsforall')).not.toBeInTheDocument();
  });

  it('sans session résolue, n’affirme aucun tenant', () => {
    rendre('/');

    expect(screen.queryByText('Garage Test SA')).not.toBeInTheDocument();
  });

  it('repliée : le nom du tenant est masqué (jamais tronqué)', async () => {
    connecte('direction');
    rendreAvecRepli('/?site=site-1', true);

    await screen.findByRole('link', { name: /^pièces$/i });
    expect(screen.queryByText('Garage Test SA')).not.toBeInTheDocument();
  });
});

/**
 * PIED COMPTE — identité + Réglages + déconnexion, regroupés dans UN SEUL déclencheur qui déplie
 * un menu (Lot « cadre applicatif », §2 de la doc de tête). RE-ARBITRAGE ASSUMÉ de la doctrine
 * « déconnexion jamais enfouie » pour un poste de PERSONNE — cette doctrine reste appliquée à la
 * lettre pour le poste PARTAGÉ (`BandeauSansNavigation.spec.tsx`).
 */
describe('BarreLaterale — pied compte', () => {
  it('affiche l’identité (initiales, nom, rôle) comme déclencheur, pas comme texte inerte', async () => {
    connecte('chef_atelier');
    rendre('/');

    const declencheur = await screen.findByRole('button', { name: /jean dupont/i });
    expect(declencheur).toHaveTextContent('Jean Dupont');
    expect(declencheur).toHaveTextContent('Chef d’atelier');
    expect(declencheur).toHaveTextContent('JD');
  });

  it('le menu est compact : nom et rôle, une seule rangée de contrôles, puis Se déconnecter avec son icône', async () => {
    connecte('chef_atelier');
    rendre('/');

    await screen.findByRole('link', { name: /^pièces$/i });
    expect(screen.queryByRole('link', { name: /^réglages$/i })).not.toBeInTheDocument();

    await ouvrirMenuCompte();
    const rangee = await screen.findByRole('group', { name: 'Réglages rapides' });
    // Langue, taille (A / A), thème, Réglages : quatre contrôles, chacun nommé et avec infobulle.
    const controles = Array.from(rangee.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
    expect(controles.map((e) => e.getAttribute('aria-label'))).toEqual([
      'Langue : Français',
      expect.stringMatching(/^Taille de l.interface : Compacte/),
      expect.stringMatching(/^Taille de l.interface : Aérée/),
      expect.stringMatching(/^Thème : Système/),
      'Réglages',
    ]);
    for (const controle of controles) expect(controle).toHaveAttribute('title');
    // Plus de grandes sections : ni liste des trois langues, ni « Thème »/« Langue » en en-têtes.
    expect(screen.queryByText('Deutsch')).not.toBeInTheDocument();
    const deconnexion = screen.getByRole('menuitem', { name: /se déconnecter/i });
    expect(deconnexion.querySelector('svg')).not.toBeNull();
    // La rangée est juste au-dessus de « Se déconnecter ».
    expect(
      rangee.compareDocumentPosition(deconnexion) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('déclenche la mutation de déconnexion au clic sur « Se déconnecter »', async () => {
    connecte('chef_atelier');
    const utilisateur = userEvent.setup();
    rendre('/');

    await ouvrirMenuCompte();
    await utilisateur.click(await screen.findByRole('menuitem', { name: /se déconnecter/i }));
    expect(mutateMock).toHaveBeenCalledOnce();
  });

  it('repliée : le déclencheur perd son texte visible mais garde son nom accessible complet', async () => {
    connecte('chef_atelier');
    rendreAvecRepli('/', true);

    const declencheur = await screen.findByRole('button', { name: /jean dupont.*chef d.atelier/i });
    expect(declencheur.querySelector('span.min-w-0')).not.toBeInTheDocument();
  });
});

describe('BarreLaterale — recherche, site et choix du compte regroupés dans la colonne', () => {
  it('la recherche est un champ en bas de colonne : après la navigation, avant le pied compte', async () => {
    connecte('direction');
    rendre('/');

    const recherche = await screen.findByRole('button', { name: 'Rechercher' });
    const derniereEntree = screen.getAllByRole('link').at(-1) as HTMLElement;
    const compte = await screen.findByRole('button', { name: /jean dupont/i });
    expect(
      recherche.compareDocumentPosition(derniereEntree) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    expect(
      recherche.compareDocumentPosition(compte) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(recherche).toHaveTextContent(/Ctrl K|⌘K/);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('repliée : la loupe seule reste atteignable', async () => {
    connecte('direction');
    rendreAvecRepli('/', true);

    const recherche = await screen.findByRole('button', { name: 'Rechercher' });
    expect(recherche).not.toHaveTextContent('Rechercher');
    expect(recherche).toHaveAttribute(
      'title',
      expect.stringMatching(/^Rechercher \((Ctrl K|⌘K)\)$/),
    );
  });

  it('thème, taille : se règlent depuis la rangée, menu laissé ouvert, état actif visible', async () => {
    connecte('direction');
    const utilisateur = userEvent.setup();
    rendre('/');

    await ouvrirMenuCompte();
    const theme = await screen.findByRole('menuitem', { name: /^Thème : Système/ });
    await utilisateur.click(theme);
    // Menu laissé ouvert : le contrôle est toujours là (le fournisseur de thème n'est pas monté ici).
    expect(screen.getByRole('menuitem', { name: /^Thème : /, hidden: false })).toBeInTheDocument();

    const grand = screen.getByRole('menuitemradio', { name: /^Taille de l.interface : Aérée/ });
    expect(grand).toHaveAttribute('aria-checked', 'false');
    await utilisateur.click(grand);
    expect(
      screen.getByRole('menuitemradio', { name: /^Taille de l.interface : Aérée/ }),
    ).toHaveAttribute('aria-checked', 'true');
    // Un second clic sur la taille active revient à « automatique ».
    await utilisateur.click(
      screen.getByRole('menuitemradio', { name: /^Taille de l.interface : Aérée/ }),
    );
    expect(
      screen.getByRole('menuitemradio', { name: /^Taille de l.interface : Aérée/ }),
    ).toHaveAttribute('aria-checked', 'false');
  });
});

/**
 * Rappel « garage à configurer » : pastille sur l'avatar + entrée « Configurer le garage » dans le
 * menu du compte, tant que l'assistant a été fermé et que le garage n'est pas configuré.
 */
const CLE_FERME = `dfa.assistant-demarrage.ferme.${SESSION_TEST.tenant.id}.${SESSION_TEST.utilisateur.id}`;
const NEUF = {
  coordonnees: false,
  iban: false,
  numeroTva: false,
  tauxHoraire: false,
  motifsRdv: false,
  premierCollaborateur: false,
  borne: false,
};
const CONFIGURE = {
  ...NEUF,
  coordonnees: true,
  iban: true,
  numeroTva: true,
  tauxHoraire: true,
  motifsRdv: true,
  premierCollaborateur: true,
  borne: true,
};

function garage(etapes: typeof NEUF, role: RoleUtilisateur = 'direction'): void {
  server.use(
    http.get('/api/v1/auth/moi', () => HttpResponse.json(creerSessionTest(role))),
    http.get('/api/v1/accueil/etat-demarrage', () => HttpResponse.json({ etapes })),
  );
}

describe('BarreLaterale — rappel de configuration du garage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reinitialiserEtatAssistant();
  });

  it('assistant fermé + garage non configuré : pastille sur l’avatar, nommée pour les lecteurs d’écran', async () => {
    window.localStorage.setItem(CLE_FERME, '1');
    garage(NEUF);
    rendre('/');

    expect(await screen.findByTestId('pastille-configuration')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /garage à configurer/i })).toBeInTheDocument();
  });

  it('repliée : la pastille reste visible sur l’avatar', async () => {
    window.localStorage.setItem(CLE_FERME, '1');
    garage(NEUF);
    rendreAvecRepli('/', true);

    expect(await screen.findByTestId('pastille-configuration')).toBeInTheDocument();
  });

  it('assistant jamais fermé : pas de pastille (il s’ouvre tout seul)', async () => {
    garage(NEUF);
    rendre('/');

    await screen.findByRole('button', { name: /jean dupont/i });
    expect(screen.queryByTestId('pastille-configuration')).not.toBeInTheDocument();
  });

  it('garage configuré : pas de pastille, pas d’entrée', async () => {
    window.localStorage.setItem(CLE_FERME, '1');
    garage(CONFIGURE);
    rendre('/');

    await screen.findByRole('button', { name: /jean dupont/i });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('pastille-configuration')).not.toBeInTheDocument();
    await ouvrirMenuCompte();
    expect(
      screen.queryByRole('menuitem', { name: 'Configurer le garage' }),
    ).not.toBeInTheDocument();
  });

  it('sans le droit de gérer les paramètres : ni pastille ni entrée', async () => {
    window.localStorage.setItem(CLE_FERME, '1');
    garage(NEUF, 'technicien');
    rendre('/');

    await screen.findByRole('button', { name: /jean dupont/i });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('pastille-configuration')).not.toBeInTheDocument();
  });

  it('« Configurer le garage » demande la réouverture de l’assistant', async () => {
    window.localStorage.setItem(CLE_FERME, '1');
    garage(NEUF);
    let demande = false;
    function Sonde() {
      demande = useEtatAssistant().ouvertureDemandee;
      return null;
    }
    const queryClient = creerQueryClientTest();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/clients']}>
          <BarreLaterale />
          <Sonde />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByTestId('pastille-configuration');
    await ouvrirMenuCompte();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Configurer le garage' }));

    expect(demande).toBe(true);
  });
});

/**
 * Bloc du garage : hauteur fixe partagée avec la rangée d'onglets (leurs filets se prolongent),
 * nom sur deux lignes au plus, sélecteur de site au-dessus du nom quand il y a plusieurs sites.
 */
describe('BarreLaterale — bloc du garage', () => {
  function enteteDuBloc(): HTMLElement {
    const nom = screen.getByTitle('Garage Test SA');
    return nom.closest('div.border-b') as HTMLElement;
  }

  it('hauteur fixe commune avec les onglets, nom limité à deux lignes, sans emplacement de logo', async () => {
    connecte('direction');
    rendre('/');
    await screen.findByText('Garage Test SA');

    expect(enteteDuBloc().className).toContain('h-[calc(var(--cible-tactile)+1px)]');
    expect(screen.getByText('Garage Test SA').className).toContain('line-clamp-2');
    expect(enteteDuBloc().querySelector('img, svg:not([aria-hidden])')).toBeNull();
  });

  it('nom long : la police baisse d’un cran plutôt que d’agrandir le bloc', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json(
          creerSessionTest('direction', {
            tenant: {
              ...SESSION_TEST.tenant,
              raisonSociale: 'Garage Carrosserie du Lac et Fils SA',
            },
          }),
        ),
      ),
    );
    rendre('/');
    const nom = await screen.findByTitle('Garage Carrosserie du Lac et Fils SA');
    expect(nom.className).toContain('texte-libelle');
  });

  it('plusieurs sites : aucun sélecteur de site dans la barre latérale, replié ou non', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json(
          creerSessionTest('direction', {
            sites: [
              { id: 'site-1', code: 'SIO', nom: 'Sion', actif: true },
              { id: 'site-2', code: 'MTG', nom: 'Martigny', actif: true },
            ],
          }),
        ),
      ),
    );
    const { unmount } = rendre('/?site=site-1');
    await screen.findByText('Garage Test SA');
    expect(screen.queryByTitle('Sion')).not.toBeInTheDocument();
    expect(screen.queryByText('SIO')).not.toBeInTheDocument();
    unmount();
    rendreAvecRepli('/?site=site-1', true);
    await screen.findByRole('link', { name: /^pièces$/i });
    expect(screen.queryByTitle('Sion')).not.toBeInTheDocument();
    expect(screen.queryByText('SIO')).not.toBeInTheDocument();
  });
});
