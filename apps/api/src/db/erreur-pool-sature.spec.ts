/**
 * Test unitaire colocalisé de `erreur-pool-sature.ts` — traduction d'un épuisement du pool `pg`
 * (`Error: timeout exceeded when trying to connect` / `Connection terminated due to connection
 * timeout`, les deux messages levés par `pg-pool`, `node_modules/pg-pool/index.js`) en
 * `ErreurMetier` 503 + `Retry-After`, plutôt que de laisser `FiltreProbleme` la normaliser en
 * `ERREUR_INTERNE`/500 générique.
 */
import { describe, expect, it } from 'vitest';

import { ErreurMetier } from '../common/erreurs/erreur-metier';
import {
  estErreurEpuisementPool,
  RETRY_APRES_SECONDES_EPUISEMENT_POOL,
  traduireErreurPoolSature,
} from './erreur-pool-sature';

describe('estErreurEpuisementPool', () => {
  it("reconnaît le message levé quand le pool est PLEIN et qu'un client en file d'attente expire", () => {
    expect(estErreurEpuisementPool(new Error('timeout exceeded when trying to connect'))).toBe(
      true,
    );
  });

  it("reconnaît le message levé quand une connexion NEUVE n'a pas terminé sa poignée de main à temps", () => {
    expect(
      estErreurEpuisementPool(new Error('Connection terminated due to connection timeout')),
    ).toBe(true);
  });

  it('refuse une erreur PostgreSQL normale (ex. contrainte violée) — ne doit jamais devenir un 503', () => {
    expect(
      estErreurEpuisementPool(new Error('duplicate key value violates unique constraint')),
    ).toBe(false);
  });

  it("refuse un statement_timeout (query_canceled) — c'est un défaut de la REQUÊTE, pas du pool", () => {
    expect(estErreurEpuisementPool(new Error('canceling statement due to statement timeout'))).toBe(
      false,
    );
  });

  it("refuse une valeur qui n'est pas une instance Error", () => {
    expect(estErreurEpuisementPool('timeout exceeded when trying to connect')).toBe(false);
    expect(estErreurEpuisementPool(null)).toBe(false);
    expect(estErreurEpuisementPool(undefined)).toBe(false);
  });
});

describe('traduireErreurPoolSature', () => {
  it('produit une ErreurMetier ERREUR_INTERNE avec un override de statut à 503', () => {
    const traduite = traduireErreurPoolSature(new Error('timeout exceeded when trying to connect'));
    expect(traduite).toBeInstanceOf(ErreurMetier);
    expect(traduite.code).toBe('ERREUR_INTERNE');
    expect(traduite.status).toBe(503);
  });

  it('porte un en-tête Retry-After en secondes entières, pour un client qui sait quand retenter', () => {
    const traduite = traduireErreurPoolSature(new Error('timeout exceeded when trying to connect'));
    expect(traduite.enTetes).toEqual({
      'Retry-After': String(RETRY_APRES_SECONDES_EPUISEMENT_POOL),
    });
  });

  it("porte le message d'origine en detail (diagnostic serveur), jamais affiché par le front", () => {
    const traduite = traduireErreurPoolSature(new Error('timeout exceeded when trying to connect'));
    expect(traduite.detail).toBe('timeout exceeded when trying to connect');
  });

  it("reste robuste si appelée avec une valeur qui n'est pas une Error", () => {
    const traduite = traduireErreurPoolSature('valeur inattendue');
    expect(traduite.status).toBe(503);
    expect(traduite.detail).toBe('valeur inattendue');
  });
});
