import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import * as api from '@/hooks/pneus/depot-pneus.api';
import { creerQueryClientTest } from '@/test/utils';

import { useDepotsPneusClient } from './useDepotsPneusClient';

function envelopper() {
  const client = creerQueryClientTest();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useDepotsPneusClient', () => {
  it('inconnu sans véhicule', () => {
    const { result } = renderHook(() => useDepotsPneusClient([], true), { wrapper: envelopper() });
    expect(result.current).toEqual({ etat: 'inconnu' });
  });

  it('present quand un véhicule du client a un jeu au dépôt', async () => {
    vi.spyOn(api, 'listerDepotsPneusVehicule').mockImplementation(async (id) => ({
      donnees: id === 'bmw' ? [{ id: 'd1', vehiculeId: 'bmw', codeCase: 'A12' } as never] : [],
      curseurSuivant: null,
      limite: 20,
    }));
    const { result } = renderHook(() => useDepotsPneusClient(['golf', 'bmw'], true), {
      wrapper: envelopper(),
    });
    expect(result.current.etat).toBe('chargement');
    await waitFor(() => expect(result.current.etat).toBe('present'));
  });

  it('absent quand aucun dépôt ; erreur distincte de absent', async () => {
    vi.spyOn(api, 'listerDepotsPneusVehicule').mockResolvedValue({
      donnees: [],
      curseurSuivant: null,
      limite: 20,
    });
    const a = renderHook(() => useDepotsPneusClient(['golf'], true), { wrapper: envelopper() });
    await waitFor(() => expect(a.result.current.etat).toBe('absent'));

    vi.spyOn(api, 'listerDepotsPneusVehicule').mockRejectedValue(new Error('boom'));
    const b = renderHook(() => useDepotsPneusClient(['bmw'], true), { wrapper: envelopper() });
    await waitFor(() => expect(b.result.current.etat).toBe('erreur'));
  });
});
