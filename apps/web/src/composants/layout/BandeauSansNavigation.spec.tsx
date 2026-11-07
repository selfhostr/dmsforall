import { creerSessionTest } from '@/test/session';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import type { SessionCourante } from '@dfa/shared';

import { creerQueryClientTest } from '@/test/utils';

import { BandeauSansNavigation } from './BandeauSansNavigation';

/**
 * Lot « cadre applicatif » (19.08.2026) — remplace `EnTete.tsx` pour les DEUX postes SANS barre
 * latérale (`poste_atelier`, mode scan mobile). Un seul besoin : la déconnexion, EN CLAIR, jamais
 * dans un menu (poste partagé) — voir la doc de tête du composant pour la justification complète.
 */
const { useSessionMock, mutateMock } = vi.hoisted(() => ({
  useSessionMock: vi.fn(),
  mutateMock: vi.fn(),
}));

vi.mock('@/hooks/useSession', () => ({ useSession: useSessionMock }));
vi.mock('@/hooks/useDeconnexion', () => ({
  useDeconnexion: () => ({ mutate: mutateMock, isPending: false }),
}));

const session: SessionCourante = creerSessionTest('poste_atelier', {
  utilisateur: {
    id: 'u-borne',
    email: 'borne@garage-martin.ch',
    prenom: 'Borne',
    nom: 'Atelier',
    role: 'poste_atelier',
    langue: 'fr',
  },
  tenant: {
    id: 't-1',
    slug: 'garage-martin',
    raisonSociale: 'Garage Martin SA',
    langueDefaut: 'fr',
    modeSignalement: 'via_site',
  },
  sites: [{ id: 'site-martigny', code: 'MTG', nom: 'Martigny', actif: true }],
  siteRattachementId: 'site-martigny',
  expireLe: new Date(Date.now() + 3_600_000).toISOString(),
});

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage/borne']}>
        <BandeauSansNavigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BandeauSansNavigation', () => {
  beforeEach(() => {
    mutateMock.mockClear();
  });

  it('affiche le bouton de déconnexion en clair, jamais dans un menu', () => {
    useSessionMock.mockReturnValue({ data: session });
    rendre();

    expect(screen.getByRole('button', { name: /se déconnecter/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ouvrir/i })).not.toBeInTheDocument();
  });

  it('ne porte ni recherche, ni tenant, ni site, ni identité — seulement la déconnexion (§2)', () => {
    useSessionMock.mockReturnValue({ data: session });
    rendre();

    expect(screen.queryByRole('button', { name: /rechercher/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Garage Martin SA')).not.toBeInTheDocument();
    expect(screen.queryByText('Martigny')).not.toBeInTheDocument();
  });

  it('déclenche la mutation de déconnexion au clic', async () => {
    useSessionMock.mockReturnValue({ data: session });
    const utilisateur = userEvent.setup();
    rendre();

    await utilisateur.click(screen.getByRole('button', { name: /se déconnecter/i }));
    expect(mutateMock).toHaveBeenCalledOnce();
  });

  it('sans session résolue, ne rend rien (jamais de bouton orphelin)', () => {
    useSessionMock.mockReturnValue({ data: undefined });
    rendre();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
