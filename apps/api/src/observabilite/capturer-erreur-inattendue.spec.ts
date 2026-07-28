import { afterEach, describe, expect, it, vi } from 'vitest';

describe('capturerErreurInattendue', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('transmet requeteId, tenantId, role, endpoint et methode comme tags sur le scope Sentry', async () => {
    const setTag = vi.fn();
    const captureException = vi.fn();
    const scope = { setTag };
    const withScope = vi.fn((callback: (scope: { setTag: typeof setTag }) => void) => callback(scope));

    vi.doMock('@sentry/nestjs', () => ({ withScope, captureException }));

    const { capturerErreurInattendue } = await import('./capturer-erreur-inattendue');
    const exception = new Error('boum');

    capturerErreurInattendue(exception, {
      requeteId: 'r-1',
      tenantId: 't-1',
      role: 'admin',
      endpoint: '/api/v1/atelier/or/:id',
      methode: 'POST',
    });

    expect(withScope).toHaveBeenCalledTimes(1);
    expect(setTag).toHaveBeenCalledWith('requeteId', 'r-1');
    expect(setTag).toHaveBeenCalledWith('tenantId', 't-1');
    expect(setTag).toHaveBeenCalledWith('role', 'admin');
    expect(setTag).toHaveBeenCalledWith('endpoint', '/api/v1/atelier/or/:id');
    expect(setTag).toHaveBeenCalledWith('methode', 'POST');
    expect(captureException).toHaveBeenCalledWith(exception);
  });

  it('n\'envoie que requeteId quand le reste du contexte est absent (pas de tag pour un champ manquant)', async () => {
    const setTag = vi.fn();
    const captureException = vi.fn();
    const withScope = vi.fn((callback: (scope: { setTag: typeof setTag }) => void) => callback({ setTag }));

    vi.doMock('@sentry/nestjs', () => ({ withScope, captureException }));

    const { capturerErreurInattendue } = await import('./capturer-erreur-inattendue');
    capturerErreurInattendue(new Error('boum'), { requeteId: 'r-1' });

    expect(setTag).toHaveBeenCalledTimes(1);
    expect(setTag).toHaveBeenCalledWith('requeteId', 'r-1');
  });

  it('ne lève jamais si Sentry.withScope lève (Sentry indisponible / mal configuré)', async () => {
    const withScope = vi.fn(() => {
      throw new Error('réseau Sentry injoignable');
    });
    const captureException = vi.fn();

    vi.doMock('@sentry/nestjs', () => ({ withScope, captureException }));

    const { capturerErreurInattendue } = await import('./capturer-erreur-inattendue');

    expect(() => capturerErreurInattendue(new Error('boum'), { requeteId: 'r-1' })).not.toThrow();
  });

  it('ne lève jamais si Sentry.captureException lève', async () => {
    const setTag = vi.fn();
    const withScope = vi.fn((callback: (scope: { setTag: typeof setTag }) => void) => callback({ setTag }));
    const captureException = vi.fn(() => {
      throw new Error('échec interne du SDK');
    });

    vi.doMock('@sentry/nestjs', () => ({ withScope, captureException }));

    const { capturerErreurInattendue } = await import('./capturer-erreur-inattendue');

    expect(() => capturerErreurInattendue(new Error('boum'), { requeteId: 'r-1' })).not.toThrow();
  });
});
