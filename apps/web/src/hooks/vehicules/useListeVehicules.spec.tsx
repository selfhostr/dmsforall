import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { VehiculeResume } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useListeVehicules } from './useListeVehicules';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const VEHICULE_TEST: VehiculeResume = {
  id: 'veh-1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Golf 8 2.0 TDI',
  vin: 'WVWZZZ1KZAP123456',
  premiereMiseEnCirculationLe: '2020-01-01',
  identificationIncomplete: false,
};

/**
 * Preuve du défaut 3 corrigé (`SelecteurVehiculeRepris.tsx`) : `useListeVehicules` accepte un
 * second paramètre `{ enabled }` facultatif, comportement inchangé quand il est omis (couvert par
 * les autres tests de ce hook et par `EcranListeVehiculesStock.spec.tsx`/`SelecteurVehiculeOrdre`
 * qui l'appellent sans options).
 */
describe('useListeVehicules — option enabled', () => {
  it('enabled: false ne déclenche AUCUNE requête réseau', async () => {
    const gestionnaire = vi.fn(() =>
      HttpResponse.json({ donnees: [VEHICULE_TEST], curseurSuivant: null, limite: 50 }),
    );
    server.use(http.get('/api/v1/vehicules', gestionnaire));

    const { result } = renderHook(
      () => useListeVehicules({ q: '', tri: 'plaque:asc' }, { enabled: false }),
      { wrapper: enveloppe() },
    );

    // Laisse le temps à un éventuel appel non désiré de partir.
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(gestionnaire).not.toHaveBeenCalled();
    expect(result.current.isPending).toBe(true);
    expect(result.current.vehicules).toEqual([]);
  });

  it('enabled: true (ou omis) déclenche la requête normalement', async () => {
    server.use(
      http.get('/api/v1/vehicules', () =>
        HttpResponse.json({ donnees: [VEHICULE_TEST], curseurSuivant: null, limite: 50 }),
      ),
    );

    const { result } = renderHook(
      () => useListeVehicules({ q: 'Golf', tri: 'plaque:asc' }, { enabled: true }),
      { wrapper: enveloppe() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.vehicules).toEqual([VEHICULE_TEST]);
  });
});
