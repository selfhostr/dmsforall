import { describe, expect, it } from 'vitest';

import type { ProblemeDetail } from '@dfa/shared';

import { ErreurApi, ErreurReseau } from '@/api/erreurs';

import { doitIgnorerErreur, initialiserSentry, signalerErreur } from './sentry';

/**
 * `src/test/setup.ts` appelle `definirEnvPourTests({ VITE_API_URL: '/api/v1' })` avant chaque
 * fichier de test, SANS `VITE_SENTRY_DSN` — exactement le cas « pas de DSN configuré » que ce
 * fichier vérifie. Les scénarios avec DSN (capture, corrélation, dégradation gracieuse) sont
 * dans sentry.capture.spec.ts et sentry.degradation.spec.ts : ils reconfigurent l'environnement
 * et mockent `@sentry/react`, ce qui doit rester isolé de ces tests-ci.
 */

function probleme(status: number, code: ProblemeDetail['code'] = 'ERREUR_INTERNE'): ProblemeDetail {
  return {
    type: `https://docs.dmsforall.example/erreurs/${code}`,
    title: 'Test',
    status,
    code,
    instance: 'req-test-000',
  };
}

describe('doitIgnorerErreur', () => {
  it('ignore une ErreurReseau (wifi d’atelier, pas un bug applicatif)', () => {
    expect(doitIgnorerErreur(new ErreurReseau())).toBe(true);
  });

  it('ignore une ErreurApi 4xx (session expirée, identifiants invalides, droit insuffisant…)', () => {
    expect(doitIgnorerErreur(new ErreurApi(probleme(401, 'AUTH_SESSION_EXPIREE')))).toBe(true);
    expect(doitIgnorerErreur(new ErreurApi(probleme(403, 'DROIT_INSUFFISANT')))).toBe(true);
    expect(doitIgnorerErreur(new ErreurApi(probleme(409, 'CONFLIT')))).toBe(true);
  });

  it('NE ignore PAS une ErreurApi 5xx (incident serveur réel, y compris ERREUR_INTERNE synthétisée)', () => {
    expect(doitIgnorerErreur(new ErreurApi(probleme(500, 'ERREUR_INTERNE')))).toBe(false);
    expect(doitIgnorerErreur(new ErreurApi(probleme(502, 'ERREUR_INTERNE')))).toBe(false);
  });

  it('NE ignore PAS une erreur applicative quelconque (crash de rendu, bug réel)', () => {
    expect(doitIgnorerErreur(new Error('boum'))).toBe(false);
  });
});

describe('initialiserSentry — sans VITE_SENTRY_DSN', () => {
  it("ne charge pas le SDK et signalerErreur se résout sans rien envoyer, l'application n'est jamais bloquée", async () => {
    expect(() => initialiserSentry()).not.toThrow();
    const idEvenement = await signalerErreur(new Error('peu importe, aucun DSN configuré'));
    expect(idEvenement).toBeUndefined();
  });
});
