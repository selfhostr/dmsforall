import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { peut, peutToutes, peutUne, usePeut } from './droits';
import { creerSessionTest } from './test/session';
import { server } from './test/msw/server';
import { creerQueryClientTest } from './test/utils';

describe('peut / peutToutes / peutUne', () => {
  const actions = ['facturation.paiement.creer', 'atelier.or.lire'];
  it('lit session.actions', () => {
    expect(peut(actions, 'atelier.or.lire')).toBe(true);
    expect(peut(actions, 'atelier.or.creer')).toBe(false);
    expect(peut(undefined, 'atelier.or.lire')).toBe(false);
  });
  it('peutToutes exige toutes les actions, peutUne au moins une', () => {
    expect(peutToutes(actions, 'atelier.or.lire', 'facturation.paiement.creer')).toBe(true);
    expect(peutToutes(actions, 'atelier.or.lire', 'atelier.or.creer')).toBe(false);
    expect(peutUne(actions, 'atelier.or.creer', 'atelier.or.lire')).toBe(true);
    expect(peutUne([], 'atelier.or.creer')).toBe(false);
  });
});

describe('usePeut', () => {
  function enveloppe(client = creerQueryClientTest()) {
    return ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }

  it('faux pendant le chargement, puis suit les actions de la session', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(creerSessionTest('technicien'))),
    );
    const { result } = renderHook(
      () => ({ lire: usePeut('atelier.or.lire'), creer: usePeut('atelier.or.creer') }),
      { wrapper: enveloppe() },
    );
    expect(result.current.lire).toBe(false);
    await waitFor(() => expect(result.current.lire).toBe(true));
    expect(result.current.creer).toBe(false);
  });
});
