import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';

/**
 * Stratégie de test délibérée : ne JAMAIS émettre un vrai `uncaughtException`/`unhandledRejection`
 * sur le `process` du worker Vitest (ça tuerait le worker, `process.exit` compris s'il n'était pas
 * mocké assez tôt). On espionne `process.on` pour CAPTURER le callback enregistré par
 * `installerGestionnairesCrash`, puis on l'invoque nous-mêmes comme le ferait Node — sans jamais
 * poser de vrai listener durable sur le `process` partagé par toute la suite.
 */
describe('installerGestionnairesCrash', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const configFactice = {} as Config;

  async function installerEtCapturerCallback(
    evenement: 'uncaughtException' | 'unhandledRejection',
    sentryMocks: { captureException: ReturnType<typeof vi.fn>; flush: ReturnType<typeof vi.fn> },
  ): Promise<(...args: unknown[]) => void> {
    vi.doMock('@sentry/nestjs', () => sentryMocks);
    const spyOn = vi.spyOn(process, 'on');
    const { installerGestionnairesCrash } = await import('./installer-gestionnaires-crash');
    installerGestionnairesCrash(configFactice);

    const appel = spyOn.mock.calls.find(([nom]) => nom === evenement);
    if (!appel) {
      throw new Error(`Aucun listener '${evenement}' enregistré par installerGestionnairesCrash.`);
    }
    return appel[1] as (...args: unknown[]) => void;
  }

  it("uncaughtException : journalise sur stderr, capture l'exception vers Sentry, attend le flush, PUIS quitte avec le code 1", async () => {
    const captureException = vi.fn();
    const flush = vi.fn().mockResolvedValue(true);
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const callback = await installerEtCapturerCallback('uncaughtException', {
      captureException,
      flush,
    });

    const exception = new Error('crash irrécupérable');
    callback(exception);
    // `capturerEtQuitter` est asynchrone (attend `Sentry.flush`) ; le callback lui-même ne
    // l'attend pas (`void capturerEtQuitter(...)`, exactement comme Node appelle le listener) —
    // on laisse la microtask queue se vider avant d'observer les effets de bord.
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('crash irrécupérable'));
    expect(stderrWrite).toHaveBeenCalledWith(expect.stringContaining('uncaughtException'));
    expect(captureException).toHaveBeenCalledWith(exception);
    expect(flush).toHaveBeenCalledWith(2_000);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('unhandledRejection : même traitement — journalise, capture, attend le flush, quitte avec le code 1 (alignement DÉLIBÉRÉ sur uncaughtException, voir le commentaire de tête du fichier source)', async () => {
    const captureException = vi.fn();
    const flush = vi.fn().mockResolvedValue(true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const callback = await installerEtCapturerCallback('unhandledRejection', {
      captureException,
      flush,
    });

    const raison = new Error('promesse jamais rattrapée');
    callback(raison, Promise.resolve());
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(captureException).toHaveBeenCalledWith(raison);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("unhandledRejection : une raison qui n'est PAS une Error (ex. chaîne rejetée) est enveloppée avant capture, jamais transmise brute", async () => {
    const captureException = vi.fn();
    const flush = vi.fn().mockResolvedValue(true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const callback = await installerEtCapturerCallback('unhandledRejection', {
      captureException,
      flush,
    });

    callback('rejet non typé', Promise.resolve());
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(captureException).toHaveBeenCalledTimes(1);
    const [erreurCapturee] = captureException.mock.calls[0] as [unknown];
    expect(erreurCapturee).toBeInstanceOf(Error);
    expect((erreurCapturee as Error).message).toBe('rejet non typé');
  });

  it('un échec de Sentry.captureException (SDK indisponible) ne bloque jamais la sortie du process — le crash reste fatal quoi qu’il arrive', async () => {
    const captureException = vi.fn(() => {
      throw new Error('réseau Sentry injoignable');
    });
    const flush = vi.fn().mockResolvedValue(true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const callback = await installerEtCapturerCallback('uncaughtException', {
      captureException,
      flush,
    });

    callback(new Error('crash'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('un flush qui ne se résout jamais assez vite ne doit pas empêcher la sortie indéfiniment — Sentry.flush(2000) porte lui-même son délai maximal, vérifié ici explicitement plutôt que supposé', async () => {
    const captureException = vi.fn();
    const flush = vi.fn().mockResolvedValue(false); // Sentry.flush résout `false` sur timeout interne, ne rejette jamais.
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const callback = await installerEtCapturerCallback('uncaughtException', {
      captureException,
      flush,
    });

    callback(new Error('crash'));
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(flush).toHaveBeenCalledWith(2_000);
    expect(exit).toHaveBeenCalledWith(1);
  });
});
