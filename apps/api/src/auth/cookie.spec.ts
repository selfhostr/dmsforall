import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

import type { Config } from '../config/config.types';
import { construireAttributsCookie, effacerCookieSession, poserCookieSession } from './cookie';

function configTest(overrides: Partial<Config> = {}): Config {
  return {
    SESSION_COOKIE_NOM: 'dfa_session',
    COOKIE_SECURE: true,
    COOKIE_DOMAINE: undefined,
    ...overrides,
  } as Config;
}

describe('construireAttributsCookie', () => {
  it('pose HttpOnly, SameSite=Lax, Path=/, et Secure selon la config', () => {
    const attrs = construireAttributsCookie(configTest({ COOKIE_SECURE: true }), 3_600);

    expect(attrs.httpOnly).toBe(true);
    expect(attrs.sameSite).toBe('lax');
    expect(attrs.path).toBe('/');
    expect(attrs.secure).toBe(true);
  });

  it('Secure=false quand COOKIE_SECURE=false (dev local http)', () => {
    const attrs = construireAttributsCookie(configTest({ COOKIE_SECURE: false }), 3_600);

    expect(attrs.secure).toBe(false);
  });

  it('convertit dureeSecondes en millisecondes pour maxAge', () => {
    const attrs = construireAttributsCookie(configTest(), 480 * 60);

    expect(attrs.maxAge).toBe(480 * 60 * 1_000);
  });

  it('maxAge ne descend jamais sous 0 même avec une durée négative', () => {
    const attrs = construireAttributsCookie(configTest(), -10);

    expect(attrs.maxAge).toBe(0);
  });

  it("n'inclut PAS `domain` quand COOKIE_DOMAINE est absent", () => {
    const attrs = construireAttributsCookie(configTest({ COOKIE_DOMAINE: undefined }), 60);

    expect(attrs).not.toHaveProperty('domain');
  });

  it('inclut `domain` quand COOKIE_DOMAINE est configuré', () => {
    const attrs = construireAttributsCookie(
      configTest({ COOKIE_DOMAINE: '.dmsforall.example' }),
      60,
    );

    expect(attrs.domain).toBe('.dmsforall.example');
  });
});

describe('poserCookieSession / effacerCookieSession', () => {
  function reponseMock(): Response {
    return { cookie: vi.fn() } as unknown as Response;
  }

  it('pose le cookie sous le nom configuré avec la valeur du jeton en clair', () => {
    const res = reponseMock();
    const config = configTest();
    const expireLe = new Date(Date.now() + 480 * 60_000);

    poserCookieSession(res, config, 'jeton-clair-test', expireLe);

    expect(res.cookie).toHaveBeenCalledWith(
      'dfa_session',
      'jeton-clair-test',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/' }),
    );
  });

  it('efface le cookie avec Max-Age=0, une valeur vide, et les MÊMES attributs que la pose', () => {
    const res = reponseMock();
    const config = configTest({ COOKIE_DOMAINE: '.dmsforall.example', COOKIE_SECURE: true });
    const expireLe = new Date(Date.now() + 480 * 60_000);

    poserCookieSession(res, config, 'jeton-clair-test', expireLe);
    effacerCookieSession(res, config);

    const [, , attrsPose] = (res.cookie as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      Record<string, unknown>,
    ];
    const [nomEffacement, valeurEffacement, attrsEffacement] = (
      res.cookie as ReturnType<typeof vi.fn>
    ).mock.calls[1] as [string, string, Record<string, unknown>];

    expect(nomEffacement).toBe('dfa_session');
    expect(valeurEffacement).toBe('');
    expect(attrsEffacement.maxAge).toBe(0);
    // Tous les attributs SAUF maxAge doivent être identiques entre pose et effacement.
    const { maxAge: _poseMaxAge, ...resteAttrsPose } = attrsPose;
    const { maxAge: _effacementMaxAge, ...resteAttrsEffacement } = attrsEffacement;
    expect(resteAttrsEffacement).toEqual(resteAttrsPose);
  });
});
