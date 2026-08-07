import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import type { SessionCourante } from '@dfa/shared';

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
});
