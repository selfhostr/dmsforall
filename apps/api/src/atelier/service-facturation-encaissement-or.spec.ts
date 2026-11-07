import { describe, expect, it, vi } from 'vitest';

import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import type { ServiceIdempotence } from '../common/idempotence';

import {
  calculerEncaissementRapide,
  ServiceFacturationEncaissementOr,
} from './service-facturation-encaissement-or';

describe('calculerEncaissementRapide', () => {
  it('espèces : multiple de 5 ct le plus proche dans les deux sens, règlement + arrondi = solde', () => {
    // 1, 2 ct : vers le bas (arrondi positif) ; 3, 4 ct : vers le haut (arrondi négatif).
    expect(calculerEncaissementRapide(10801, 'especes', undefined, true)).toEqual({
      reglementCentimes: 10800,
      arrondiCentimes: 1,
    });
    expect(calculerEncaissementRapide(10842, 'especes', undefined, true)).toEqual({
      reglementCentimes: 10840,
      arrondiCentimes: 2,
    });
    expect(calculerEncaissementRapide(10844, 'especes', undefined, true)).toEqual({
      reglementCentimes: 10845,
      arrondiCentimes: -1,
    });
    expect(calculerEncaissementRapide(10803, 'especes', undefined, true)).toEqual({
      reglementCentimes: 10805,
      arrondiCentimes: -2,
    });
    expect(calculerEncaissementRapide(10809, 'especes', undefined, true)).toEqual({
      reglementCentimes: 10810,
      arrondiCentimes: -1,
    });
  });

  it('solde de 1 ou 2 ct : jamais de paiement nul, solde exact', () => {
    expect(calculerEncaissementRapide(2, 'especes', undefined, true)).toEqual({
      reglementCentimes: 2,
      arrondiCentimes: 0,
    });
  });

  it('jamais d’arrondi hors espèces, paramètre inactif, solde multiple de 5 ou montant partiel', () => {
    expect(calculerEncaissementRapide(10801, 'carte', undefined, true).arrondiCentimes).toBe(0);
    expect(calculerEncaissementRapide(10801, 'twint', undefined, true).arrondiCentimes).toBe(0);
    expect(calculerEncaissementRapide(10801, 'especes', undefined, false).arrondiCentimes).toBe(0);
    expect(calculerEncaissementRapide(10805, 'especes', undefined, true).arrondiCentimes).toBe(0);
    expect(calculerEncaissementRapide(10801, 'especes', 5000, true)).toEqual({
      reglementCentimes: 5000,
      arrondiCentimes: 0,
    });
  });

  it('montant explicite égal au solde : même arrondi que le solde par défaut', () => {
    expect(calculerEncaissementRapide(10801, 'especes', 10801, true)).toEqual({
      reglementCentimes: 10800,
      arrondiCentimes: 1,
    });
  });
});

describe('ServiceFacturationEncaissementOr — droits', () => {
  it('refuse AVANT tout effet de bord un rôle sans droit d’encaisser quand un paiement est demandé', async () => {
    const executer = vi.fn();
    const service = new ServiceFacturationEncaissementOr(
      {} as never,
      { executer } as unknown as ServiceIdempotence,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const ctx = { tenantId: 't', utilisateurId: 'u', requeteId: null };
    const principal = { role: 'chef_atelier' } as PrincipalAuthentifie;

    await expect(
      service.facturerEtEncaisser(ctx, principal, 'or', { paiement: { mode: 'carte' } }, 'cle'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT' } satisfies Partial<ErreurMetier>);
    expect(executer).not.toHaveBeenCalled();
  });
});
