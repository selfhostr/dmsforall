import { describe, expect, it, vi } from 'vitest';

import { definirEnvPourTests } from '@/config/env';

import { initialiserSentry, signalerErreur } from './sentry';

/**
 * Fichier séparé des autres specs de ce dossier : ce `vi.mock('@sentry/react', …)` fait échouer
 * `Sentry.init` à dessein, ce qui rendrait le module Sentry définitivement `null` pour le reste
 * du fichier (promesse mise en cache par `initialiserSentry`) — incompatible avec les scénarios
 * de capture réussie de sentry.capture.spec.ts.
 *
 * Exigence vérifiée : une instance Sentry injoignable (DSN qui pointe vers un service en panne,
 * maintenance, etc.) ne doit ni bloquer ni ralentir l'application — seulement dégrader la
 * supervision pour la session en cours.
 */
vi.mock('@sentry/react', () => ({
  init: vi.fn(() => {
    throw new Error('instance Sentry injoignable (simulée)');
  }),
  withScope: vi.fn(),
  captureException: vi.fn(),
}));

describe('initialiserSentry — instance Sentry injoignable', () => {
  it("l'échec de Sentry.init est rattrapé silencieusement : l'application continue sans supervision", async () => {
    definirEnvPourTests({
      VITE_API_URL: '/api/v1',
      VITE_SENTRY_DSN: 'https://cle@instance-en-panne.exemple.ch/1',
    });
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(() => initialiserSentry()).not.toThrow();

    const idEvenement = await signalerErreur(
      new Error('un vrai bug, mais sans supervision disponible'),
    );
    expect(idEvenement).toBeUndefined();
    expect(avertissement).toHaveBeenCalledTimes(1);

    avertissement.mockRestore();
  });
});
