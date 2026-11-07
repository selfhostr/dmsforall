import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ReponseOrdreReparation } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { ErreurApi } from '@/api/erreurs';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useMarquerLignesRealisees } from './useActionsLigneOr';

function ligne(id: string, statut: string) {
  return { id, statut };
}

function orEnCache(lignes: readonly { id: string; statut: string }[]) {
  return { id: 'or-1', lignes } as unknown as ReponseOrdreReparation;
}

function installer(queryClient: ReturnType<typeof creerQueryClientTest>) {
  return renderHook(() => useMarquerLignesRealisees('or-1'), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

describe('useMarquerLignesRealisees', () => {
  it('appelle marquer-realisee une fois par ligne, saute les lignes déjà réalisées et reporte le statut dans le cache', async () => {
    const queryClient = creerQueryClientTest();
    queryClient.setQueryData(
      clesQuery.or.detail('or-1'),
      orEnCache([ligne('l-1', 'validee'), ligne('l-2', 'realisee'), ligne('l-3', 'en_cours')]),
    );
    const appels: string[] = [];
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/lignes/:ligneId/marquer-realisee', ({ params }) => {
        appels.push(String(params.ligneId));
        return HttpResponse.json({
          donnees: { id: params.ligneId, statut: 'realisee' },
          avertissements: [],
        });
      }),
      http.get('/api/v1/ordres-reparation/or-1', () =>
        HttpResponse.json(orEnCache([ligne('l-1', 'realisee')])),
      ),
    );

    const { result } = installer(queryClient);
    let envoyees = 0;
    await act(async () => {
      envoyees = await result.current.mutateAsync(['l-1', 'l-2', 'l-3', 'l-1']);
    });

    expect(appels).toEqual(['l-1', 'l-3']);
    expect(envoyees).toBe(2);
  });

  it("s'arrête à la première erreur, la relance telle quelle (ErreurApi) et garde les lignes déjà passées dans le cache", async () => {
    const queryClient = creerQueryClientTest();
    queryClient.setQueryData(
      clesQuery.or.detail('or-1'),
      orEnCache([ligne('l-1', 'validee'), ligne('l-2', 'validee'), ligne('l-3', 'validee')]),
    );
    const appels: string[] = [];
    server.use(
      http.post('/api/v1/ordres-reparation/or-1/lignes/:ligneId/marquer-realisee', ({ params }) => {
        appels.push(String(params.ligneId));
        if (params.ligneId === 'l-2') {
          return HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/LIGNE_TRANSITION_INTERDITE',
              title: 'Transition interdite',
              status: 409,
              code: 'LIGNE_TRANSITION_INTERDITE',
              detail: 'Aucun temps pointé.',
              instance: 'req-1',
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json({
          donnees: { id: params.ligneId, statut: 'realisee' },
          avertissements: [],
        });
      }),
      // La relecture déclenchée par l'invalidation ne doit pas masquer le report local.
      http.get('/api/v1/ordres-reparation/or-1', () =>
        HttpResponse.json(orEnCache([ligne('l-1', 'realisee')])),
      ),
    );

    const { result } = installer(queryClient);
    await act(async () => {
      result.current.mutate(['l-1', 'l-2', 'l-3']);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(appels).toEqual(['l-1', 'l-2']);
    expect(result.current.error).toBeInstanceOf(ErreurApi);
    expect((result.current.error as ErreurApi).probleme.detail).toBe('Aucun temps pointé.');
  });
});
