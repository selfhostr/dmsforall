import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import type { Config } from '../config/config.types';
import type { ServiceContexteRequete } from '../common/contexte/contexte-requete.service';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { GardeSession } from './garde-session';
import { ErreurOrigineRefusee, ErreurSessionAbsente, ErreurSessionExpiree } from './erreurs-auth';
import type { ServiceSession } from './auth.types';

const PRINCIPAL_TEST: PrincipalAuthentifie = {
  sessionId: 'session-id',
  tenantId: 'tenant-id',
  utilisateurId: 'utilisateur-id',
  role: 'admin',
  langue: 'fr',
};

function configTest(overrides: Partial<Config> = {}): Config {
  return {
    SESSION_COOKIE_NOM: 'dfa_session',
    WEB_URL_PUBLIQUE: 'https://app.dmsforall.example',
    NODE_ENV: 'production',
    ...overrides,
  } as Config;
}

function reflectorTest(estPublic: boolean): Reflector {
  return { getAllAndOverride: vi.fn().mockReturnValue(estPublic) } as unknown as Reflector;
}

function contexteExecutionTest(options: {
  method: string;
  origin?: string;
  cookies?: Record<string, string>;
}): { context: ExecutionContext; req: Request } {
  const req = {
    method: options.method,
    headers: options.origin !== undefined ? { origin: options.origin } : {},
    cookies: options.cookies ?? {},
  } as unknown as Request;

  const context = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
    getHandler: () => (): void => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;

  return { context, req };
}

function serviceSessionTest(
  resoudre: (token: string) => Promise<PrincipalAuthentifie | null>,
): ServiceSession {
  return { ouvrir: vi.fn(), resoudre: vi.fn(resoudre), fermer: vi.fn() };
}

describe('GardeSession — vérification Origin (toute méthode ≠ GET/HEAD)', () => {
  it('laisse passer une méthode GET sans en-tête Origin', async () => {
    const { context } = contexteExecutionTest({ method: 'GET' });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );
    // Cookie absent → doit lever AUTH_SESSION_ABSENTE, PAS AUTH_ORIGINE_REFUSEE : la preuve que
    // la vérification Origin a bien été sautée pour GET.
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurSessionAbsente);
  });

  it('rejette un POST sans en-tête Origin, même sur une route @Public', async () => {
    const { context } = contexteExecutionTest({ method: 'POST' });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(true), // @Public
      configTest(),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurOrigineRefusee);
  });

  it("rejette un POST dont l'Origin ne correspond pas à WEB_URL_PUBLIQUE", async () => {
    const { context } = contexteExecutionTest({
      method: 'POST',
      origin: 'https://malveillant.example',
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurOrigineRefusee);
  });

  it('accepte un POST dont l’Origin correspond exactement à WEB_URL_PUBLIQUE', async () => {
    const { context } = contexteExecutionTest({
      method: 'POST',
      origin: 'https://app.dmsforall.example',
      cookies: { dfa_session: 'jeton' },
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('un Origin malformé (pas une URL valide) est refusé, jamais une 500', async () => {
    const { context } = contexteExecutionTest({ method: 'POST', origin: 'pas-une-url' });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurOrigineRefusee);
  });
});

describe('GardeSession — tolérance loopback localhost/127.0.0.1 (dev uniquement)', () => {
  function configLoopback(nodeEnv: Config['NODE_ENV'] = 'development'): Config {
    return configTest({ WEB_URL_PUBLIQUE: 'http://localhost:5173', NODE_ENV: nodeEnv });
  }

  it("accepte, en dev, un POST dont l'Origin est http://127.0.0.1:5173 alors que WEB_URL_PUBLIQUE vaut http://localhost:5173", async () => {
    const { context } = contexteExecutionTest({
      method: 'POST',
      origin: 'http://127.0.0.1:5173',
      cookies: { dfa_session: 'jeton' },
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configLoopback('development'),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('refuse la même équivalence 127.0.0.1/localhost en production (NODE_ENV=production)', async () => {
    const { context } = contexteExecutionTest({
      method: 'POST',
      origin: 'http://127.0.0.1:5173',
      cookies: { dfa_session: 'jeton' },
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configLoopback('production'),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurOrigineRefusee);
  });

  it('refuse un port différent même sur un hôte loopback en dev (127.0.0.1:9999 ≠ localhost:5173)', async () => {
    const { context } = contexteExecutionTest({
      method: 'POST',
      origin: 'http://127.0.0.1:9999',
      cookies: { dfa_session: 'jeton' },
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configLoopback('development'),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurOrigineRefusee);
  });

  it("refuse un hôte LAN/tiers en dev : la tolérance ne s'étend jamais au-delà de localhost/127.0.0.1", async () => {
    const { context } = contexteExecutionTest({
      method: 'POST',
      origin: 'http://192.168.1.42:5173',
      cookies: { dfa_session: 'jeton' },
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configLoopback('development'),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurOrigineRefusee);
  });
});

describe('GardeSession — @Public', () => {
  it('laisse passer sans résoudre de session ni attacher de principal', async () => {
    const { context } = contexteExecutionTest({ method: 'GET' });
    const resoudre = vi.fn(async () => PRINCIPAL_TEST);
    const attacherPrincipal = vi.fn();
    const contexteRequete = {
      attacherPrincipal,
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(true),
      configTest(),
      { ouvrir: vi.fn(), resoudre, fermer: vi.fn() },
      contexteRequete,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resoudre).not.toHaveBeenCalled();
    expect(attacherPrincipal).not.toHaveBeenCalled();
  });
});

describe('GardeSession — session requise', () => {
  it('lève AUTH_SESSION_ABSENTE quand aucun cookie de session n’est présent', async () => {
    const { context } = contexteExecutionTest({ method: 'GET', cookies: {} });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurSessionAbsente);
  });

  it('propage AUTH_SESSION_ABSENTE/EXPIREE levée par serviceSession.resoudre() (cas réel)', async () => {
    const { context } = contexteExecutionTest({
      method: 'GET',
      cookies: { dfa_session: 'jeton-invalide' },
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => {
        throw new ErreurSessionExpiree();
      }),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('garde-fou défensif : lève AUTH_SESSION_EXPIREE si resoudre() rend null au lieu de lever (contrat `| null` légal mais non attendu en pratique)', async () => {
    const { context } = contexteExecutionTest({
      method: 'GET',
      cookies: { dfa_session: 'jeton-invalide' },
    });
    const contexteRequete = {
      attacherPrincipal: vi.fn(),
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => null),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ErreurSessionExpiree);
  });

  it('attache le principal au contexte ET à la requête Express quand la session est valide', async () => {
    const { context, req } = contexteExecutionTest({
      method: 'GET',
      cookies: { dfa_session: 'jeton-valide' },
    });
    const attacherPrincipal = vi.fn();
    const contexteRequete = {
      attacherPrincipal,
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async (token) => (token === 'jeton-valide' ? PRINCIPAL_TEST : null)),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(attacherPrincipal).toHaveBeenCalledWith(PRINCIPAL_TEST);
    expect(req.dfaPrincipal).toEqual(PRINCIPAL_TEST);
  });
});

describe('GardeSession — attacherPrincipal() appelé une seule fois par requête', () => {
  it('un second appel à attacherPrincipal() sur le même contexte lève (comportement de ServiceContexteRequete)', async () => {
    // Simule fidèlement le contrat de `ServiceContexteRequete.attacherPrincipal` (§2.9) : « Appelé
    // UNE SEULE FOIS par GardeSession ; lève au 2e appel. » GardeSession ne doit l'invoquer qu'une
    // fois par requête traitée — ce test le prouve en appelant canActivate() deux fois de suite
    // sur le MÊME contexte (simulant un guard mal enregistré deux fois) et vérifie que la seconde
    // tentative d'attacher échoue bruyamment plutôt que d'écraser silencieusement le principal.
    let dejaAttache = false;
    const attacherPrincipal = vi.fn((_p: PrincipalAuthentifie) => {
      if (dejaAttache) {
        throw new Error('attacherPrincipal() déjà appelé pour cette requête.');
      }
      dejaAttache = true;
    });
    const contexteRequete = {
      attacherPrincipal,
      actuelOuNull: vi.fn(),
    } as unknown as ServiceContexteRequete;
    const { context } = contexteExecutionTest({
      method: 'GET',
      cookies: { dfa_session: 'jeton-valide' },
    });
    const guard = new GardeSession(
      reflectorTest(false),
      configTest(),
      serviceSessionTest(async () => PRINCIPAL_TEST),
      contexteRequete,
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(attacherPrincipal).toHaveBeenCalledTimes(1);

    // Un second passage (double exécution du guard) doit propager l'erreur de
    // `ServiceContexteRequete`, pas l'avaler : mieux vaut un 500 bruyant qu'un principal
    // silencieusement incohérent entre deux exécutions du même guard.
    await expect(guard.canActivate(context)).rejects.toThrow(
      'attacherPrincipal() déjà appelé pour cette requête.',
    );
    expect(attacherPrincipal).toHaveBeenCalledTimes(2);
  });
});
