import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { EntreeCreationVehicule, ReponseVehicule } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useCreerVehicule } from './useCreerVehicule';

function enveloppe(queryClient = creerQueryClientTest()) {
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const ENTREE_TEST: EntreeCreationVehicule = {
  marque: 'Volkswagen',
  modele: 'Golf',
  importe: false,
};

const VEHICULE_CREE: ReponseVehicule = {
  id: 'veh-9',
  vin: null,
  marque: 'Volkswagen',
  modele: 'Golf',
  version: null,
  finition: null,
  codeTypeCh: null,
  premiereMiseEnCirculationLe: null,
  designation: 'Volkswagen Golf',
  plaque: null,
  canton: null,
  carburant: null,
  cylindreeCm3: null,
  puissanceKw: null,
  boite: null,
  transmission: null,
  normeEmission: null,
  couleur: null,
  codeCouleur: null,
  poidsVideKg: null,
  poidsTotalKg: null,
  places: null,
  pneusEte: null,
  pneusHiver: null,
  pressionPneus: null,
  huileType: null,
  huileQuantiteDl: null,
  batterie: null,
  codeRadio: null,
  codeCle: null,
  intervalleEntretienKm: null,
  intervalleEntretienMois: null,
  importe: { estImporte: false, paysOrigine: null, importeLe: null },
  garantieConstructeur: null,
  garantieGarage: null,
  proprietaireEconomiqueClientId: null,
  conducteurHabituel: null,
  identificationIncomplete: true,
  statut: 'actif',
  motifArchivage: null,
  fusionneVersVehiculeId: null,
  emplacementLibre: null,
  emplacementMajLe: null,
  creeLe: '2026-08-04T08:00:00.000Z',
  modifieLe: '2026-08-04T08:00:00.000Z',
};

describe('useCreerVehicule', () => {
  it("envoie l'Idempotency-Key et résout avec les avertissements — un VIN court/absent RÉUSSIT (RM-15), il ne bloque jamais", async () => {
    let cleRecue: string | null = null;
    server.use(
      http.post('/api/v1/vehicules', async ({ request }) => {
        cleRecue = request.headers.get('Idempotency-Key');
        return HttpResponse.json({
          donnees: VEHICULE_CREE,
          avertissements: [{ code: 'VEHICULE_VIN_COURT', message: 'VIN absent ou incomplet.' }],
        });
      }),
    );

    const { result } = renderHook(() => useCreerVehicule(), { wrapper: enveloppe() });

    let reponse: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;
    await act(async () => {
      reponse = await result.current.mutateAsync({
        entree: ENTREE_TEST,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
      });
    });

    expect(cleRecue).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.current.isError).toBe(false);
    expect(reponse?.donnees.id).toBe('veh-9');
    expect(reponse?.avertissements[0]?.code).toBe('VEHICULE_VIN_COURT');
  });

  it('invalide toutes les variantes de `vehicules.liste` après une création réussie', async () => {
    server.use(
      http.post('/api/v1/vehicules', () =>
        HttpResponse.json({ donnees: VEHICULE_CREE, avertissements: [] }),
      ),
    );

    const queryClient = creerQueryClientTest();
    queryClient.setQueryData(clesQuery.vehicules.liste({ q: 'x' }), 'donnee-perimee');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreerVehicule(), { wrapper: enveloppe(queryClient) });

    await act(async () => {
      await result.current.mutateAsync({
        entree: ENTREE_TEST,
        idempotencyKey: '22222222-2222-4222-8222-222222222222',
      });
    });

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['vehicules', 'liste'] }),
    );
  });
});
