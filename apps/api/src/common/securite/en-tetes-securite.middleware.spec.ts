/**
 * Tests unitaires — finding H-01 (audit sécurité). Couvre les trois exigences de la tâche :
 *   1. HSTS uniquement en production ET sur une requête réellement HTTPS (jamais en dev/localhost).
 *   2. CSP différenciée : stricte (`default-src 'none'`) sur l'API, relâchée mais scopée sur
 *      `/api/docs*` (Swagger) pour ne pas le rendre blanc.
 *   3. `X-Frame-Options`/`Referrer-Policy` posés inconditionnellement.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

import { construireMiddlewareEnTetesSecurite } from './en-tetes-securite.middleware';

function requeteTest(chemin: string, securisee: boolean): Request {
  return { path: chemin, secure: securisee } as unknown as Request;
}

function reponseTest(): Response & { setHeader: ReturnType<typeof vi.fn> } {
  return { setHeader: vi.fn() } as unknown as Response & { setHeader: ReturnType<typeof vi.fn> };
}

describe('construireMiddlewareEnTetesSecurite — HSTS', () => {
  it("ne pose PAS Strict-Transport-Security en développement, même sur une requête 'secure'", () => {
    const middleware = construireMiddlewareEnTetesSecurite({ NODE_ENV: 'development' });
    const res = reponseTest();

    middleware(requeteTest('/api/v1/recherche', true), res, vi.fn() as NextFunction);

    expect(res.setHeader).not.toHaveBeenCalledWith('Strict-Transport-Security', expect.anything());
  });

  it('ne pose PAS Strict-Transport-Security en production sur une requête HTTP (req.secure = false)', () => {
    const middleware = construireMiddlewareEnTetesSecurite({ NODE_ENV: 'production' });
    const res = reponseTest();

    middleware(requeteTest('/api/v1/recherche', false), res, vi.fn() as NextFunction);

    expect(res.setHeader).not.toHaveBeenCalledWith('Strict-Transport-Security', expect.anything());
  });

  it('pose Strict-Transport-Security en production sur une requête HTTPS (req.secure = true)', () => {
    const middleware = construireMiddlewareEnTetesSecurite({ NODE_ENV: 'production' });
    const res = reponseTest();

    middleware(requeteTest('/api/v1/recherche', true), res, vi.fn() as NextFunction);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      expect.stringContaining('max-age='),
    );
  });

  it("n'active jamais HSTS en 'test' (même garde-fou que 'development')", () => {
    const middleware = construireMiddlewareEnTetesSecurite({ NODE_ENV: 'test' });
    const res = reponseTest();

    middleware(requeteTest('/api/v1/recherche', true), res, vi.fn() as NextFunction);

    expect(res.setHeader).not.toHaveBeenCalledWith('Strict-Transport-Security', expect.anything());
  });
});

describe('construireMiddlewareEnTetesSecurite — CSP', () => {
  const middleware = construireMiddlewareEnTetesSecurite({ NODE_ENV: 'production' });

  it("pose une CSP stricte ('default-src \\'none\\'') sur une route API ordinaire", () => {
    const res = reponseTest();
    middleware(requeteTest('/api/v1/recherche', true), res, vi.fn() as NextFunction);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Security-Policy',
      expect.stringContaining("default-src 'none'"),
    );
  });

  it.each(['/api/docs', '/api/docs.json', '/api/docs/swagger-ui-bundle.js'])(
    'relâche la CSP (self + unsafe-inline) sur %s pour ne pas casser Swagger',
    (chemin) => {
      const res = reponseTest();
      middleware(requeteTest(chemin, true), res, vi.fn() as NextFunction);

      const appelCsp = res.setHeader.mock.calls.find(([nom]) => nom === 'Content-Security-Policy');
      expect(appelCsp?.[1]).toContain("default-src 'self'");
      expect(appelCsp?.[1]).toContain("script-src 'self' 'unsafe-inline'");
    },
  );

  it("ne relâche PAS la CSP pour un chemin qui contient juste '/api/docs' en préfixe d'un AUTRE segment", () => {
    const res = reponseTest();
    middleware(requeteTest('/api/docsautrechose', true), res, vi.fn() as NextFunction);

    const appelCsp = res.setHeader.mock.calls.find(([nom]) => nom === 'Content-Security-Policy');
    expect(appelCsp?.[1]).toContain("default-src 'none'");
  });

  it("conserve frame-ancestors 'none' même sur la CSP relâchée de Swagger", () => {
    const res = reponseTest();
    middleware(requeteTest('/api/docs', true), res, vi.fn() as NextFunction);

    const appelCsp = res.setHeader.mock.calls.find(([nom]) => nom === 'Content-Security-Policy');
    expect(appelCsp?.[1]).toContain("frame-ancestors 'none'");
  });
});

describe('construireMiddlewareEnTetesSecurite — en-têtes inconditionnels', () => {
  it('pose X-Frame-Options: DENY et Referrer-Policy: no-referrer sur toute réponse, et appelle next()', () => {
    const middleware = construireMiddlewareEnTetesSecurite({ NODE_ENV: 'development' });
    const res = reponseTest();
    const next = vi.fn() as NextFunction;

    middleware(requeteTest('/api/v1/recherche', false), res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    expect(res.setHeader).toHaveBeenCalledWith('Referrer-Policy', 'no-referrer');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
