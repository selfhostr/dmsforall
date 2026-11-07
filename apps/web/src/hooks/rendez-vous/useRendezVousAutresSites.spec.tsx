import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { creerQueryClientTest } from '@/test/utils';

import * as api from './rendez-vous.api';
import { useRendezVousAutresSites } from './useRendezVousAutresSites';

function rdv(dateLe: string, statut: string) {
  return { id: `${dateLe}-${statut}`, dateLe, statut } as never;
}

describe('useRendezVousAutresSites', () => {
  it('compte les rendez-vous non annulés des AUTRES sites, jour par jour', async () => {
    const lister = vi.spyOn(api, 'listerRendezVous').mockResolvedValue({
      donnees: [
        rdv('2026-11-10', 'confirme'),
        rdv('2026-11-10', 'confirme'),
        rdv('2026-11-10', 'annule'),
        rdv('2026-11-11', 'confirme'),
      ],
      curseurSuivant: null,
      limite: 50,
    });
    const client = creerQueryClientTest();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useRendezVousAutresSites(
          [
            { id: 'sion', nom: 'Sion' },
            { id: 'martigny', nom: 'Martigny' },
          ],
          'sion',
          { du: '2026-11-09', au: '2026-11-15' },
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current[0]?.total).toBe(3));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      siteId: 'martigny',
      nom: 'Martigny',
      parJour: { '2026-11-10': 2, '2026-11-11': 1 },
    });
    expect(lister).toHaveBeenCalledTimes(1);
    expect(lister).toHaveBeenCalledWith({ siteId: 'martigny', du: '2026-11-09', au: '2026-11-15' });
  });

  it('ne charge rien tant que le site courant est inconnu', () => {
    const lister = vi.spyOn(api, 'listerRendezVous').mockClear();
    const client = creerQueryClientTest();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useRendezVousAutresSites([{ id: 'sion', nom: 'Sion' }], undefined, { du: 'a', au: 'b' }),
      { wrapper },
    );
    expect(result.current).toEqual([]);
    expect(lister).not.toHaveBeenCalled();
  });
});
