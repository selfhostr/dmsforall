import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';

function configTest(surcharges: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'development',
    VERSION_APP: '0.1.0-test',
    SENTRY_DSN: undefined,
    SENTRY_ENVIRONMENT: undefined,
    SENTRY_TAUX_ECHANTILLONNAGE_TRACES: 0.1,
    ...surcharges,
  } as Config;
}

describe('initialiserSentry', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("ne fait rien (n'appelle pas Sentry.init) quand SENTRY_DSN est absent", async () => {
    const init = vi.fn();
    vi.doMock('@sentry/nestjs', () => ({ init }));

    const { initialiserSentry } = await import('./initialiser-sentry');
    initialiserSentry(configTest({ SENTRY_DSN: undefined }));

    expect(init).not.toHaveBeenCalled();
  });

  it("appelle Sentry.init avec le DSN, l'environnement, la release et le taux d'échantillonnage quand SENTRY_DSN est présent", async () => {
    const init = vi.fn();
    vi.doMock('@sentry/nestjs', () => ({ init }));

    const { initialiserSentry } = await import('./initialiser-sentry');
    initialiserSentry(
      configTest({
        SENTRY_DSN: 'https://cle@sentry.interne.dmsforall.example/1',
        SENTRY_ENVIRONMENT: 'production',
        VERSION_APP: '1.2.3',
        SENTRY_TAUX_ECHANTILLONNAGE_TRACES: 0.05,
      }),
    );

    expect(init).toHaveBeenCalledTimes(1);
    const options = init.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      dsn: 'https://cle@sentry.interne.dmsforall.example/1',
      environment: 'production',
      release: '1.2.3',
      tracesSampleRate: 0.05,
      sendDefaultPii: false,
    });
    expect(typeof options.beforeSend).toBe('function');
  });

  it("retombe sur NODE_ENV quand SENTRY_ENVIRONMENT n'est pas défini", async () => {
    const init = vi.fn();
    vi.doMock('@sentry/nestjs', () => ({ init }));

    const { initialiserSentry } = await import('./initialiser-sentry');
    initialiserSentry(
      configTest({
        SENTRY_DSN: 'https://cle@sentry.interne.dmsforall.example/1',
        NODE_ENV: 'test',
        SENTRY_ENVIRONMENT: undefined,
      }),
    );

    const options = init.mock.calls[0]?.[0];
    expect(options.environment).toBe('test');
  });

  it('ne lève jamais si Sentry.init lève (config SDK invalide, transport indisponible…)', async () => {
    const init = vi.fn(() => {
      throw new Error('DSN invalide côté SDK');
    });
    vi.doMock('@sentry/nestjs', () => ({ init }));

    const { initialiserSentry } = await import('./initialiser-sentry');

    expect(() =>
      initialiserSentry(
        configTest({ SENTRY_DSN: 'https://cle@sentry.interne.dmsforall.example/1' }),
      ),
    ).not.toThrow();
  });
});
