/**
 * Test unitaire colocalisé — dimensionnement du pool `pg` (`DATABASE_POOL_MIN`,
 * `DATABASE_TIMEOUT_CONNEXION_MS`, `DATABASE_TIMEOUT_IDLE_MS`). Fichier séparé de
 * `charger-config.spec.ts` (propriété déclarée d'un autre lot, non touché ici) pour éviter
 * toute collision d'écriture — voir `apps/api/src/db/acces-base.service.ts` pour l'usage réel de
 * ces trois variables et `apps/api/src/db/erreur-pool-sature.ts` pour le défaut qui a motivé leur
 * introduction (`timeout exceeded when trying to connect` mesuré sous charge, 88 reproductions).
 */
import { describe, expect, it } from 'vitest';

import { chargerConfig, ErreurConfigInvalide } from './charger-config';

const ENV_VALIDE: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  PORT: '3000',
  API_URL_PUBLIQUE: 'http://localhost:3000',
  WEB_URL_PUBLIQUE: 'http://localhost:5173',
  DATABASE_URL: 'postgresql://dfa_app:x@localhost:5432/dfa_dev',
  DATABASE_URL_MIGRATION: 'postgresql://dfa_migrator:x@localhost:5432/dfa_dev',
  REDIS_URL: 'redis://localhost:6379',
};

function envValide(surcharges: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return { ...ENV_VALIDE, ...surcharges };
}

describe('DATABASE_POOL_MIN / DATABASE_TIMEOUT_CONNEXION_MS / DATABASE_TIMEOUT_IDLE_MS — défauts', () => {
  it('charge sans erreur avec les défauts (min=2, connexion=5000ms, idle=30000ms)', () => {
    const config = chargerConfig(envValide());
    expect(config.DATABASE_POOL_MIN).toBe(2);
    expect(config.DATABASE_TIMEOUT_CONNEXION_MS).toBe(5_000);
    expect(config.DATABASE_TIMEOUT_IDLE_MS).toBe(30_000);
  });

  it('accepte des valeurs personnalisées pour les trois variables', () => {
    const config = chargerConfig(
      envValide({
        DATABASE_POOL_MIN: '4',
        DATABASE_TIMEOUT_CONNEXION_MS: '8000',
        DATABASE_TIMEOUT_IDLE_MS: '60000',
      }),
    );
    expect(config.DATABASE_POOL_MIN).toBe(4);
    expect(config.DATABASE_TIMEOUT_CONNEXION_MS).toBe(8_000);
    expect(config.DATABASE_TIMEOUT_IDLE_MS).toBe(60_000);
  });

  it('accepte DATABASE_POOL_MIN=0 (comportement historique : le pool peut se vider complètement)', () => {
    const config = chargerConfig(envValide({ DATABASE_POOL_MIN: '0' }));
    expect(config.DATABASE_POOL_MIN).toBe(0);
  });

  it('refuse DATABASE_POOL_MIN strictement supérieur à DATABASE_POOL_MAX', () => {
    expect(() =>
      chargerConfig(envValide({ DATABASE_POOL_MAX: '5', DATABASE_POOL_MIN: '6' })),
    ).toThrow(ErreurConfigInvalide);
  });

  it('accepte DATABASE_POOL_MIN égal à DATABASE_POOL_MAX (pool à taille fixe, valide)', () => {
    const config = chargerConfig(envValide({ DATABASE_POOL_MAX: '5', DATABASE_POOL_MIN: '5' }));
    expect(config.DATABASE_POOL_MIN).toBe(5);
    expect(config.DATABASE_POOL_MAX).toBe(5);
  });

  it('la variable fautive listée dans ErreurConfigInvalide est DATABASE_POOL_MIN', () => {
    try {
      chargerConfig(envValide({ DATABASE_POOL_MAX: '3', DATABASE_POOL_MIN: '10' }));
      expect.fail('devait lever ErreurConfigInvalide');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurConfigInvalide);
      const typee = erreur as ErreurConfigInvalide;
      expect(typee.problemes.some((p) => p.variable === 'DATABASE_POOL_MIN')).toBe(true);
    }
  });

  it('refuse DATABASE_TIMEOUT_IDLE_MS en dessous du plancher (1000ms)', () => {
    expect(() => chargerConfig(envValide({ DATABASE_TIMEOUT_IDLE_MS: '500' }))).toThrow(
      ErreurConfigInvalide,
    );
  });
});
