import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import type { ReponseDossierReprise } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { calculerIntervalleSondageDossier, useDossierRepriseActif } from './useDossierRepriseActif';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function dossier(partiel: Partial<ReponseDossierReprise> = {}): ReponseDossierReprise {
  return {
    id: 'dossier-1',
    statut: 'depot_en_cours',
    archive: {
      tailleOctetsAnnoncee: 1000,
      octetsRecus: 0,
      dernierNumeroTrancheRecuContigu: null,
      empreinteSha256Annoncee: 'a'.repeat(64),
      empreinteSha256Verifiee: null,
      integriteValidee: null,
    },
    analyseId: null,
    planId: null,
    importId: null,
    creeLe: '2026-08-24T08:00:00.000Z',
    modifieLe: '2026-08-24T08:00:00.000Z',
    ...partiel,
  };
}

describe('useDossierRepriseActif', () => {
  it('rend null (état vide légitime) quand aucun dossier n’existe encore', async () => {
    server.use(
      http.get('/api/v1/reprise/dossiers', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 1 }),
      ),
    );

    const { result } = renderHook(() => useDossierRepriseActif(), { wrapper: enveloppe() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('rend le dossier le plus récent renvoyé par la collection', async () => {
    const attendu = dossier({ id: 'dossier-recent' });
    server.use(
      http.get('/api/v1/reprise/dossiers', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('tri')).toBe('creeLe:desc');
        expect(url.searchParams.get('limite')).toBe('1');
        return HttpResponse.json({ donnees: [attendu], curseurSuivant: null, limite: 1 });
      }),
    );

    const { result } = renderHook(() => useDossierRepriseActif(), { wrapper: enveloppe() });

    await waitFor(() => expect(result.current.data?.id).toBe('dossier-recent'));
  });
});

describe('calculerIntervalleSondageDossier — le sondage s’arrête à l’état terminal', () => {
  it('aucun dossier -> sondage arrêté (rien à observer)', () => {
    expect(calculerIntervalleSondageDossier(null)).toBe(false);
  });

  it.each([
    'depot_en_cours',
    'depot_receptionne',
    'analyse_en_cours',
    'plan_propose',
    'import_en_cours',
  ] as const)('dossier non terminal (%s) -> sondage actif toutes les 4 s', (statut) => {
    expect(calculerIntervalleSondageDossier(dossier({ statut }))).toBe(4_000);
  });

  it.each(['import_termine', 'annule'] as const)(
    'dossier terminal (%s) -> sondage arrêté',
    (statut) => {
      expect(calculerIntervalleSondageDossier(dossier({ statut }))).toBe(false);
    },
  );
});
