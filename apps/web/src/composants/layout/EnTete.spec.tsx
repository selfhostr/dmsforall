import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import type { SessionCourante } from '@dfa/shared';

import { FournisseurSiteCourant } from '@/hooks/site/ContexteSiteCourant';
import { creerQueryClientTest } from '@/test/utils';

import { EnTete } from './EnTete';

/**
 * Régression : l'en-tête calculait le nom de site depuis la session
 * (`session.sites.find(actif) ?? sites[0]`) au lieu du `?site=` de l'URL — mécanisme déjà corrigé
 * dans BarreLaterale.tsx. Un utilisateur consultant le site de Sion via l'URL voyait « Martigny »
 * (premier site de la session) écrit en haut de son écran. Ces tests verrouillent le mécanisme
 * corrigé : l'URL est la source, jamais la session ; rien n'est affirmé quand `?site=` est absent
 * ou ne correspond à aucun site connu.
 */

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock('@/hooks/useSession', () => ({ useSession: useSessionMock }));
vi.mock('@/hooks/useDeconnexion', () => ({
  useDeconnexion: () => ({ mutate: vi.fn(), isPending: false }),
}));

const session: SessionCourante = {
  utilisateur: {
    id: 'u-1',
    email: 'a@garage-martin.ch',
    prenom: 'Anna',
    nom: 'Dupont',
    role: 'admin',
    langue: 'fr',
  },
  tenant: {
    id: 't-1',
    slug: 'garage-martin',
    raisonSociale: 'Garage Martin SA',
    langueDefaut: 'fr',
  },
  sites: [
    { id: 'site-martigny', code: 'MTG', nom: 'Martigny', actif: true },
    { id: 'site-sion', code: 'SIO', nom: 'Sion', actif: true },
  ],
  // Compte de personne (role: 'admin') : jamais rattaché à un site unique, voir la doc de
  // `SessionCourante.siteRattachementId` dans `@dfa/shared` (renseigné exactement pour les rôles
  // de `ROLES_COMPTE_DE_SERVICE`, ex. `poste_atelier`).
  siteRattachementId: null,
  expireLe: new Date(Date.now() + 3_600_000).toISOString(),
};

/** Même rendu que `rendre`, sous `FournisseurSiteCourant` — seul moyen d'exercer la préférence de
 *  site mémorisée (`hooks/site/ContexteSiteCourant.tsx`, issue #91). */
function rendreAvecPreferenceSite(routeInitiale: string) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <FournisseurSiteCourant>
          <EnTete />
        </FournisseurSiteCourant>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rendre(routeInitiale: string) {
  // `RechercheGlobale` (Lot A, montée dans `EnTete` depuis le centre de la barre haute) appelle
  // `useRechercheComptoir`, donc `useQuery` — un `QueryClientProvider` est désormais requis même
  // si aucun de ces tests n'ouvre le panneau (la requête reste `enabled: false` tant que rien
  // n'est saisi, aucun handler MSW n'est donc nécessaire ici).
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[routeInitiale]}>
        <EnTete />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EnTete', () => {
  beforeEach(() => {
    useSessionMock.mockReturnValue({ data: session });
  });

  it('affiche le site de l’URL même quand il diffère du premier site de la session', () => {
    rendre('/vehicules?site=site-sion');

    expect(screen.getByText('Sion')).toBeInTheDocument();
    expect(screen.queryByText('Martigny')).not.toBeInTheDocument();
  });

  it('n’affirme aucun nom de site quand l’URL n’en porte pas', () => {
    rendre('/');

    expect(screen.queryByText('Martigny')).not.toBeInTheDocument();
    expect(screen.queryByText('Sion')).not.toBeInTheDocument();
  });

  it('ne plante pas et n’affiche pas la valeur brute de l’URL quand elle ne correspond à aucun site de la session', () => {
    rendre('/vehicules?site=site-inconnu');

    expect(screen.queryByText('site-inconnu')).not.toBeInTheDocument();
    expect(screen.queryByText('Martigny')).not.toBeInTheDocument();
    expect(screen.queryByText('Sion')).not.toBeInTheDocument();
  });

  /**
   * Régression issue #91 : « tous les sites » est un choix légitime pour le FILTRE du tableau de
   * bord (`ecrans/tableau-bord/SelecteurSiteTableauBord.tsx`), jamais le libellé d'une absence de
   * choix — doctrine maison « absence de donnée ≠ valeur ». Avant ce correctif, l'en-tête affichait
   * « Tous les sites » aussi bien pour un choix explicite que pour l'absence totale de choix.
   */
  it('n’affiche jamais « Tous les sites » quand aucun site n’a été choisi (absence ≠ valeur)', () => {
    rendre('/');

    expect(screen.getByText('Aucun site choisi')).toBeInTheDocument();
    expect(screen.queryByText('Tous les sites')).not.toBeInTheDocument();
  });
});

/**
 * Régression issue #91 (« il oublie mon choix dès que je change d'écran ») — l'en-tête reprend la
 * dernière préférence mémorisée quand l'URL courante n'en porte aucune, plutôt que d'afficher
 * aussitôt « Aucun site choisi » comme si rien n'avait jamais été choisi.
 */
describe('EnTete — reprise de la préférence de site', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('affiche le dernier site mémorisé quand l’URL n’en porte pas', () => {
    window.localStorage.setItem('dfa.site-courant.t-1', 'site-sion');
    useSessionMock.mockReturnValue({ data: session });

    rendreAvecPreferenceSite('/');

    expect(screen.getByText('Sion')).toBeInTheDocument();
    expect(screen.queryByText('Aucun site choisi')).not.toBeInTheDocument();
  });

  it('l’URL reste prioritaire sur la préférence mémorisée', () => {
    window.localStorage.setItem('dfa.site-courant.t-1', 'site-sion');
    useSessionMock.mockReturnValue({ data: session });

    rendreAvecPreferenceSite('/vehicules?site=site-martigny');

    expect(screen.getByText('Martigny')).toBeInTheDocument();
    expect(screen.queryByText('Sion')).not.toBeInTheDocument();
  });
});

/**
 * CHANGEUR DE SITE (demande @laupernoe, revue webui du 10.08.2026) — jusqu'ici le nom de site sous le
 * tenant était un texte inerte. `session` (2 sites, tous ACTIFS) prouve le cas à plusieurs sites ;
 * `sessionSiteUnique` prouve qu'un menu à une seule option n'est jamais affiché.
 */
describe('EnTete — changeur de site', () => {
  const sessionSiteUnique: SessionCourante = {
    ...session,
    sites: [{ id: 'site-martigny', code: 'MTG', nom: 'Martigny', actif: true }],
  };

  it('plusieurs sites actifs : le nom de site devient un déclencheur qui propose les AUTRES sites', async () => {
    useSessionMock.mockReturnValue({ data: session });
    const utilisateur = userEvent.setup();
    rendre('/vehicules?site=site-martigny');

    const declencheur = screen.getByRole('button', { name: /martigny/i });
    await utilisateur.click(declencheur);

    expect(await screen.findByRole('menuitem', { name: 'Sion' })).toBeInTheDocument();
    // Le site déjà consulté n'est pas reproposé dans son propre menu (« changer de site »,
    // pas se reconfirmer sur le même).
    expect(screen.queryByRole('menuitem', { name: 'Martigny' })).not.toBeInTheDocument();
  });

  it('ne liste que les sites ACTIFS dans le menu, jamais un site désactivé', async () => {
    const sessionAvecSiteInactif: SessionCourante = {
      ...session,
      sites: [...session.sites, { id: 'site-ferme', code: 'FER', nom: 'Site fermé', actif: false }],
    };
    useSessionMock.mockReturnValue({ data: sessionAvecSiteInactif });
    const utilisateur = userEvent.setup();
    rendre('/vehicules?site=site-martigny');

    await utilisateur.click(screen.getByRole('button', { name: /martigny/i }));

    expect(await screen.findByRole('menuitem', { name: 'Sion' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Site fermé' })).not.toBeInTheDocument();
  });

  it('un seul site actif : aucun sélecteur — un menu à une option est du bruit', () => {
    useSessionMock.mockReturnValue({ data: sessionSiteUnique });
    rendre('/vehicules?site=site-martigny');

    expect(screen.getByText('Martigny')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /martigny/i })).not.toBeInTheDocument();
  });
});

/**
 * SÉLECTEUR DE LANGUE RETIRÉ (demande @laupernoe, revue webui du 10.08.2026) — la langue se choisit déjà
 * à la connexion et rejoint les Réglages. `SelecteurLangue` lui-même n'est PAS supprimé
 * (`EcranConnexion`/`ConsoleShell` le montent toujours) : seul son montage dans `EnTete` disparaît.
 */
describe('EnTete — sélecteur de langue', () => {
  it('ne monte plus SelecteurLangue', () => {
    useSessionMock.mockReturnValue({ data: session });
    rendre('/');

    expect(screen.queryByRole('group', { name: /langue/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^fr$/i })).not.toBeInTheDocument();
  });
});
