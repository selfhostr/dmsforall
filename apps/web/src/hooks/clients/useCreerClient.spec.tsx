import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { EntreeCreationClient, ReponseClient } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useCreerClient } from './useCreerClient';

function enveloppe(queryClient = creerQueryClientTest()) {
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const ENTREE_TEST: EntreeCreationClient = {
  type: 'particulier',
  langueCorrespondance: 'fr',
  nom: 'Dupont',
  adressePrincipale: { rue: 'Rue du Lac 1', npa: '1000', localite: 'Lausanne', pays: 'CH' },
  telephones: [],
  poObligatoire: false,
};

const CLIENT_CREE: ReponseClient = {
  id: 'cl-9',
  numeroClient: 'CL-000009',
  type: 'particulier',
  statut: 'actif',
  civilite: null,
  nom: 'Dupont',
  prenom: null,
  raisonSociale: null,
  nomAffiche: 'Dupont',
  ide: null,
  langueCorrespondance: 'fr',
  email: null,
  telephone: null,
  telephoneE164: null,
  poObligatoire: false,
  groupeId: null,
  fusionneVersClientId: null,
  referenceExterne: null,
  dernierPassageLe: null,
  creeLe: '2026-07-28T08:00:00.000Z',
  modifieLe: '2026-07-28T08:00:00.000Z',
  notesAlerte: [],
};

describe('useCreerClient', () => {
  it("envoie l'Idempotency-Key et résout avec les avertissements — un doublon probable RÉUSSIT (CT-01), il ne bloque jamais", async () => {
    let cleRecue: string | null = null;
    server.use(
      http.post('/api/v1/clients', async ({ request }) => {
        cleRecue = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          donnees: CLIENT_CREE,
          avertissements: [{ code: 'CLIENT_DOUBLON_PROBABLE', message: 'Un client similaire existe.' }],
        });
      }),
    );

    const { result } = renderHook(() => useCreerClient(), { wrapper: enveloppe() });

    let reponse: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      reponse = await result.current.mutateAsync({
        entree: ENTREE_TEST,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      });
    });

    expect(cleRecue).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.current.isError).toBe(false);
    expect(reponse?.donnees.id).toBe('cl-9');
    expect(reponse?.avertissements[0]?.code).toBe('CLIENT_DOUBLON_PROBABLE');
  });

  it('invalide toutes les variantes de `clients.liste` après une création réussie', async () => {
    server.use(http.post('/api/v1/clients', () => HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] })));

    const queryClient = creerQueryClientTest();
    queryClient.setQueryData(clesQuery.clients.liste({ q: 'x' }), 'donnee-perimee');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreerClient(), { wrapper: enveloppe(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({ entree: ENTREE_TEST, idempotencyKey: '22222222-2222-4222-8222-222222222222' });
    });

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients', 'liste'] }));
  });
});
