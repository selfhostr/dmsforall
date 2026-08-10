import type { ReponseRecherche, ResultatRecherche, SessionCourante } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { PanneauResultatsRecherche } from './PanneauResultatsRecherche';

// cmdk (navigation clavier de CommandList) appelle `Element.scrollIntoView` — absent de jsdom —
// et `CommandList` observe sa hauteur via `ResizeObserver` — également absent de jsdom. Stubs
// locaux à ce fichier, aucune autre suite n'utilise `Command` pour l'instant.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

// `PanneauResultatsRecherche` lit le rôle courant (`useSession`) pour distinguer « aucun résultat
// parce que la donnée n'existe pas » de « aucun résultat dans ce que j'ai eu le droit de chercher »
// (RF-115/RF-116, voir `droits-recherche.ts`) — même patron de mock que `EnTete.spec.tsx`. Mocker
// le module entier évite tout besoin de `QueryClientProvider` ici : `useSession` ne passe jamais
// par le vrai `useQuery`.
const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));
vi.mock('@/hooks/useSession', () => ({ useSession: useSessionMock }));

function sessionAvecRole(role: SessionCourante['utilisateur']['role']): { data: SessionCourante } {
  return {
    data: {
      utilisateur: {
        id: 'u-1',
        email: 'u@garage-martin.ch',
        prenom: 'Anna',
        nom: 'Dupont',
        role,
        langue: 'fr',
      },
      tenant: {
        id: 't-1',
        slug: 'garage-martin',
        raisonSociale: 'Garage Martin SA',
        langueDefaut: 'fr',
      },
      sites: [{ id: 'site-1', code: 'MTG', nom: 'Martigny', actif: true }],
      siteRattachementId: null,
      expireLe: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
}

const VEHICULE_A: ResultatRecherche = {
  type: 'vehicule',
  id: 'va',
  score: 0.9,
  correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
  resume: { plaque: 'VD 123456', designation: 'VW Touran 2.0 TDI' },
};

const VEHICULE_B: ResultatRecherche = {
  type: 'vehicule',
  id: 'vb',
  score: 0.6,
  correspondance: {
    champ: 'plaque',
    valeur: 'VD 123456',
    historique: true,
    porteeJusquLe: '2025-02-01',
  },
  resume: { plaque: 'FR 4711', designation: 'Opel Corsa 1.2', detenteurNom: 'Rossi Maria' },
};

const CLIENT_A: ResultatRecherche = {
  type: 'client',
  id: 'ca',
  score: 0.5,
  correspondance: { champ: 'nom', valeur: 'Meier', historique: false },
  resume: { nom: 'Meier Hans', numeroClient: 'CL-042' },
};

function panneau(reponse: ReponseRecherche | null, surcharges: Record<string, unknown> = {}) {
  return (
    <PanneauResultatsRecherche
      valeur=""
      onValeurChange={vi.fn()}
      reponse={reponse}
      onSelectionner={vi.fn()}
      {...surcharges}
    />
  );
}

describe('PanneauResultatsRecherche', () => {
  // Rôle par défaut avec accès complet aux sept natures (`direction`) : préserve le comportement
  // historique des tests ci-dessous, qui ne portent pas sur les droits.
  beforeEach(() => {
    useSessionMock.mockReturnValue(sessionAvecRole('direction'));
  });

  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('parcourt les résultats au clavier de bout en bout, sans souris', async () => {
    const onSelectionner = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      panneau(
        { resultats: [VEHICULE_A, CLIENT_A], plaqueInterchangeable: false },
        { onSelectionner },
      ),
    );

    const champ = screen.getByRole('combobox');
    champ.focus();
    // Premier élément auto-sélectionné par cmdk au montage (VEHICULE_A) ; une flèche bas passe
    // au groupe suivant (CLIENT_A), Entrée confirme.
    await utilisateur.keyboard('{ArrowDown}{Enter}');

    expect(onSelectionner).toHaveBeenCalledTimes(1);
    expect(onSelectionner).toHaveBeenCalledWith(CLIENT_A);
  });

  it('Échap déclenche onEchap', async () => {
    const onEchap = vi.fn();
    const utilisateur = userEvent.setup();
    render(panneau({ resultats: [VEHICULE_A], plaqueInterchangeable: false }, { onEchap }));
    screen.getByRole('combobox').focus();
    await utilisateur.keyboard('{Escape}');
    expect(onEchap).toHaveBeenCalledTimes(1);
  });

  it('distingue un résultat historique par un rôle "note" dédié', () => {
    render(panneau({ resultats: [VEHICULE_A, VEHICULE_B], plaqueInterchangeable: false }));
    expect(screen.getByRole('note')).toHaveTextContent(/Rossi Maria/);
  });

  it('plaqueInterchangeable : affiche les DEUX véhicules et ne présélectionne rien (RM-18)', () => {
    render(panneau({ resultats: [VEHICULE_A, VEHICULE_B], plaqueInterchangeable: true }));

    expect(screen.getByText(/VW Touran 2\.0 TDI/)).toBeInTheDocument();
    expect(screen.getByText(/Opel Corsa 1\.2/)).toBeInTheDocument();

    // Rendus comme choix explicites (boutons), pas comme options `cmdk` avec présélection.
    const choix = screen.getAllByRole('button');
    expect(choix).toHaveLength(2);
    for (const bouton of choix) {
      expect(bouton).not.toHaveAttribute('aria-selected', 'true');
    }
    // Aucun `option` cmdk pour les véhicules eux-mêmes dans ce mode.
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('état de chargement : montre le message dédié', () => {
    render(panneau(null, { enChargement: true }));
    // `{ ignore: ... }` exclut la région `aria-live` (annonce lecteur d'écran, même texte que le
    // message visible `CommandEmpty` par construction) : sans lui, deux nœuds portent "Recherche…"
    // et `getByText` échouerait sur un match ambigu.
    expect(screen.getByText('Recherche…', { ignore: '[aria-live]' })).toBeInTheDocument();
  });

  it('état vide : la variante recherche dédiée, jamais un tableau vide silencieux', () => {
    render(panneau({ resultats: [], plaqueInterchangeable: false }));
    expect(screen.getByText('Aucun résultat', { ignore: '[aria-live]' })).toBeInTheDocument();
  });

  // Régression du défaut constaté en navigateur (RF-115/RF-116) : `admin` cherche `GDB1330DTE`,
  // une référence d'article RÉELLEMENT présente au jeu de démo. `pieces.article.lire` et
  // `pieces.fournisseur.lire` lui sont fermés (`droits-recherche.ts`) — le serveur ne fait
  // remonter aucun résultat de ces deux natures, à raison (il ne fuit pas leur existence). Un
  // test qui se contenterait de vérifier « Aucun résultat » passerait AUSSI avec l'ancien
  // message : celui-ci vérifie le texte HONNÊTE (périmètre restreint + ce qui a été cherché),
  // absent avant ce correctif, et l'ABSENCE du texte plat trompeur.
  it('état vide, rôle sans droit sur une nature de recherche (admin) : dit que le périmètre est restreint, jamais « Aucun résultat » sec', () => {
    useSessionMock.mockReturnValue(sessionAvecRole('admin'));
    render(panneau({ resultats: [], plaqueInterchangeable: false }));

    expect(
      screen.getByText('Aucun résultat dans les données auxquelles vous avez accès', {
        ignore: '[aria-live]',
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Aucun résultat', { ignore: '[aria-live]', exact: true })).toBeNull();

    // Dit CE QUI a été cherché (sûr, RF-116) — jamais qu'un article ou un fournisseur précis
    // existe ailleurs : ni compte de résultats masqués, ni nom des natures EXCLUES.
    const description = screen.getByText(/Votre recherche a porté sur/, { ignore: '[aria-live]' });
    expect(description).toHaveTextContent('véhicules');
    expect(description).toHaveTextContent('clients');
    expect(description).toHaveTextContent('ordres de réparation');
    expect(description).not.toHaveTextContent('articles');
    expect(description).not.toHaveTextContent('fournisseurs');
  });

  // `direction` a tous les droits `pieces.*` : le cas nominal ne doit pas s'alourdir — même
  // message plat qu'avant ce correctif, pas de mention de périmètre.
  it('état vide, rôle avec accès complet (direction) : garde le message plat, sans mention de périmètre', () => {
    useSessionMock.mockReturnValue(sessionAvecRole('direction'));
    render(panneau({ resultats: [], plaqueInterchangeable: false }));

    expect(screen.getByText('Aucun résultat', { ignore: '[aria-live]' })).toBeInTheDocument();
    expect(
      screen.queryByText('Aucun résultat dans les données auxquelles vous avez accès', {
        ignore: '[aria-live]',
      }),
    ).toBeNull();
  });

  // Régression du défaut inverse (revue transversale, distinct de RF-115/RF-116 ci-dessus) :
  // `role` peut valoir `undefined` avant que la session soit résolue — la palette Ctrl+K est
  // montée dans l'en-tête, donc affichable avant que `RouteProtegee` ait eu la moindre chance de
  // bloquer quoi que ce soit (constaté par l'échec réel de `EcranRecherche.spec.tsx` : 401 sur
  // `/auth/moi`, palette déjà montée). Dans ce cas, le serveur a réellement cherché dans les sept
  // natures (portillon appliqué sur la session SERVEUR, pas sur ce que le front sait) : afficher
  // « votre recherche a porté sur véhicules, clients et ordres de réparation » serait FAUX, pas
  // prudent. Le panneau doit retomber sur le message plat, jamais la variante périmètre restreint.
  it('session en cours de résolution (rôle inconnu) : jamais la variante « périmètre restreint », message plat', () => {
    useSessionMock.mockReturnValue({ data: undefined, isPending: true });
    render(panneau({ resultats: [], plaqueInterchangeable: false }));

    expect(screen.getByText('Aucun résultat', { ignore: '[aria-live]' })).toBeInTheDocument();
    expect(
      screen.queryByText('Aucun résultat dans les données auxquelles vous avez accès', {
        ignore: '[aria-live]',
      }),
    ).toBeNull();
  });

  it('session résolue à « pas de session » (401 sur /auth/moi, rôle inconnu) : même garde, message plat', () => {
    useSessionMock.mockReturnValue({ data: null, isPending: false });
    render(panneau({ resultats: [], plaqueInterchangeable: false }));

    expect(screen.getByText('Aucun résultat', { ignore: '[aria-live]' })).toBeInTheDocument();
    expect(
      screen.queryByText('Aucun résultat dans les données auxquelles vous avez accès', {
        ignore: '[aria-live]',
      }),
    ).toBeNull();
  });

  it('rôle restreint (admin) : le lecteur d’écran est aussi averti du périmètre restreint (aria-live)', () => {
    useSessionMock.mockReturnValue(sessionAvecRole('admin'));
    render(panneau({ resultats: [], plaqueInterchangeable: false }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Aucun résultat dans les données auxquelles vous avez accès',
    );
  });

  it('annonce le nombre de résultats à chaque changement pour un lecteur d’écran (aria-live)', () => {
    const { rerender } = render(panneau(null));
    expect(screen.getByRole('status')).toHaveTextContent('');

    rerender(panneau({ resultats: [VEHICULE_A, CLIENT_A], plaqueInterchangeable: false }));
    expect(screen.getByRole('status')).toHaveTextContent('2 résultats trouvés');

    rerender(panneau({ resultats: [], plaqueInterchangeable: false }));
    expect(screen.getByRole('status')).toHaveTextContent('Aucun résultat');

    rerender(panneau(null, { enChargement: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Recherche…');
  });

  it('traduit le libellé du groupe véhicules en allemand', async () => {
    await i18n.changeLanguage('de');
    render(panneau({ resultats: [VEHICULE_A], plaqueInterchangeable: false }));
    expect(screen.getByText('1 Fahrzeug')).toBeInTheDocument();
  });
});
