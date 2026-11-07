import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionCourante } from '@dfa/shared';

import { creerSessionTest } from '@/test/session';

import { FournisseurSiteCourant, useSiteCourant } from './ContexteSiteCourant';

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));
vi.mock('@/hooks/useSession', () => ({ useSession: useSessionMock }));

function session(tenantId: string): SessionCourante {
  const base = creerSessionTest('direction');
  return {
    ...base,
    utilisateur: { ...base.utilisateur, id: 'u-1', email: 'a@garage-martin.ch', prenom: 'Anna' },
    tenant: {
      id: tenantId,
      slug: 'garage-martin',
      raisonSociale: 'Garage Martin SA',
      langueDefaut: 'fr',
    },
    sites: [
      { id: 'site-sion', code: 'SIO', nom: 'Sion', actif: true },
      { id: 'site-martigny', code: 'MTG', nom: 'Martigny', actif: true },
    ],
  };
}

describe('useSiteCourant', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it('hors fournisseur : aucune préférence, `definirPreferenceSite` ne lève jamais', () => {
    const { result } = renderHook(() => useSiteCourant());

    expect(result.current.preferenceSiteId).toBeUndefined();
    expect(() => result.current.definirPreferenceSite('site-sion')).not.toThrow();
  });

  it('sous le fournisseur, sans préférence stockée : `preferenceSiteId` est `undefined`', () => {
    useSessionMock.mockReturnValue({ data: session('t-1') });
    const { result } = renderHook(() => useSiteCourant(), {
      wrapper: FournisseurSiteCourant,
    });

    expect(result.current.preferenceSiteId).toBeUndefined();
  });

  it('lit une préférence déjà persistée pour ce tenant au montage', () => {
    window.localStorage.setItem('dfa.site-courant.t-1', 'site-sion');
    useSessionMock.mockReturnValue({ data: session('t-1') });

    const { result } = renderHook(() => useSiteCourant(), {
      wrapper: FournisseurSiteCourant,
    });

    expect(result.current.preferenceSiteId).toBe('site-sion');
  });

  it('definirPreferenceSite met à jour l’état ET le localStorage namespacé par tenant', () => {
    useSessionMock.mockReturnValue({ data: session('t-1') });
    const { result } = renderHook(() => useSiteCourant(), {
      wrapper: FournisseurSiteCourant,
    });

    act(() => result.current.definirPreferenceSite('site-martigny'));

    expect(result.current.preferenceSiteId).toBe('site-martigny');
    expect(window.localStorage.getItem('dfa.site-courant.t-1')).toBe('site-martigny');
  });

  it('deux tenants ne partagent jamais leur préférence (poste de démo multi-garages)', () => {
    window.localStorage.setItem('dfa.site-courant.t-1', 'site-sion');
    window.localStorage.setItem('dfa.site-courant.t-2', 'site-martigny');

    useSessionMock.mockReturnValue({ data: session('t-2') });
    const { result } = renderHook(() => useSiteCourant(), {
      wrapper: FournisseurSiteCourant,
    });

    expect(result.current.preferenceSiteId).toBe('site-martigny');
  });
});
