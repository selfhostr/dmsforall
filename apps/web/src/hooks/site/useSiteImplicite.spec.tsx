import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { siteUniqueActif } from './sites';
import { useSiteImplicite } from './useSiteImplicite';

function enveloppe({ children }: { readonly children: ReactNode }) {
  return <QueryClientProvider client={creerQueryClientTest()}>{children}</QueryClientProvider>;
}

function connecter(sites: typeof SESSION_TEST.sites) {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json({ ...SESSION_TEST, sites })));
}

describe('siteUniqueActif', () => {
  it('un seul site actif (les inactifs ne comptent pas) : son id', () => {
    expect(
      siteUniqueActif([
        { id: 'a', actif: true },
        { id: 'b', actif: false },
      ]),
    ).toBe('a');
  });
  it('zéro ou plusieurs : aucun site implicite', () => {
    expect(siteUniqueActif([])).toBeUndefined();
    expect(siteUniqueActif(undefined)).toBeUndefined();
    expect(
      siteUniqueActif([
        { id: 'a', actif: true },
        { id: 'b', actif: true },
      ]),
    ).toBeUndefined();
  });
});

describe('useSiteImplicite', () => {
  it('garage mono-site : site implicite', async () => {
    connecter(SESSION_TEST.sites);
    const { result } = renderHook(() => useSiteImplicite(), { wrapper: enveloppe });
    await waitFor(() => expect(result.current.pret).toBe(true));
    expect(result.current).toMatchObject({ estMonoSite: true, siteId: 'site-1' });
  });

  it('plusieurs sites : rien d’implicite', async () => {
    connecter([
      ...SESSION_TEST.sites,
      { id: 'site-2', code: 'S2', codeCourt: 'S2', nom: 'Deux', actif: true },
    ]);
    const { result } = renderHook(() => useSiteImplicite(), { wrapper: enveloppe });
    await waitFor(() => expect(result.current.pret).toBe(true));
    expect(result.current).toMatchObject({ estMonoSite: false, siteId: undefined });
  });
});
