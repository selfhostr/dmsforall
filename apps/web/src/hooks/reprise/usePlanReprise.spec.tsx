import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ReponsePlanReprise } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useModifierPlanReprise, useValiderPlanReprise } from './usePlanReprise';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function plan(partiel: Partial<ReponsePlanReprise> = {}): ReponsePlanReprise {
  return {
    id: 'plan-1',
    dossierRepriseId: 'dossier-1',
    analyseId: 'analyse-1',
    statut: 'propose',
    elements: [],
    exclusions: [],
    proposeLe: '2026-08-24T08:00:00.000Z',
    valideLe: null,
    valideParUtilisateurId: null,
    ...partiel,
  };
}

describe('useModifierPlanReprise — le levier inclusion/exclusion modifie le corps envoyé', () => {
  it('envoie exactement les ajustements demandés à PATCH /reprise/dossiers/{id}/plan', async () => {
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/reprise/dossiers/dossier-1/plan', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(plan({ statut: 'propose' }));
      }),
    );

    const { result } = renderHook(() => useModifierPlanReprise('dossier-1'), {
      wrapper: enveloppe(),
    });

    await act(async () => {
      await result.current.mutateAsync([{ elementId: 'elt-clients', inclus: false }]);
    });

    expect(corpsRecu).toEqual({ ajustements: [{ elementId: 'elt-clients', inclus: false }] });
  });

  it('un exclude puis un ré-include distincts produisent deux corps différents', async () => {
    const corps: unknown[] = [];
    server.use(
      http.patch('/api/v1/reprise/dossiers/dossier-1/plan', async ({ request }) => {
        corps.push(await request.json());
        return HttpResponse.json(plan());
      }),
    );

    const { result } = renderHook(() => useModifierPlanReprise('dossier-1'), {
      wrapper: enveloppe(),
    });

    await act(async () => {
      await result.current.mutateAsync([{ elementId: 'elt-vehicules', inclus: false }]);
    });
    await act(async () => {
      await result.current.mutateAsync([{ elementId: 'elt-vehicules', inclus: true }]);
    });

    expect(corps).toEqual([
      { ajustements: [{ elementId: 'elt-vehicules', inclus: false }] },
      { ajustements: [{ elementId: 'elt-vehicules', inclus: true }] },
    ]);
  });
});

describe('useValiderPlanReprise', () => {
  it('POST /plan/valider porte une Idempotency-Key et un corps vide', async () => {
    let entete: string | null = null;
    let corps: unknown;
    server.use(
      http.post('/api/v1/reprise/dossiers/dossier-1/plan/valider', async ({ request }) => {
        entete = request.headers.get('Idempotency-Key');
        corps = await request.json();
        return HttpResponse.json(plan({ statut: 'valide', valideLe: '2026-08-24T09:00:00.000Z' }));
      }),
    );

    const { result } = renderHook(() => useValiderPlanReprise('dossier-1'), {
      wrapper: enveloppe(),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(entete).not.toBeNull();
    expect(corps).toEqual({});
  });
});
