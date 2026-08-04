/**
 * Validation de la configuration au démarrage (contrat gelé §2.7). Ne démarre AUCUN conteneur —
 * `chargerConfig` est une fonction pure (env → Config | throw), rangé sous test/integration/
 * par convention du plan de travail plutôt que par nécessité technique.
 */

import { describe, expect, it } from 'vitest';
import { chargerConfig, ErreurConfigInvalide } from '../../src/config';

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

describe('validation de la configuration au démarrage (schéma zod, échec rapide)', () => {
  it('une configuration valide et complète est chargée sans erreur', () => {
    expect(() => chargerConfig(envValide())).not.toThrow();
  });

  it('les valeurs par défaut documentées sont appliquées quand une variable optionnelle est absente', () => {
    const config = chargerConfig(envValide());
    expect(config.PORT).toBe(3000);
    expect(config.SESSION_DUREE_MINUTES).toBe(480);
    expect(config.SESSION_INACTIVITE_MINUTES).toBe(120);
    expect(config.COOKIE_SECURE).toBe(true);
  });

  it('une variable obligatoire manquante lève ErreurConfigInvalide', () => {
    const env = envValide();
    delete env.API_URL_PUBLIQUE;
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });

  it('plusieurs variables manquantes à la fois sont TOUTES listées dans ErreurConfigInvalide, pas seulement la première', () => {
    const env = envValide();
    delete env.API_URL_PUBLIQUE;
    delete env.DATABASE_URL;
    delete env.REDIS_URL;

    // 1 assertion pour le type d'erreur + 1 par variable fautive attendue (3 ici) : la vérification
    // porte précisément sur le fait que TOUTES sont listées, pas seulement la première.
    expect.assertions(4);
    try {
      chargerConfig(env);
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurConfigInvalide);
      const variablesFautives = (erreur as ErreurConfigInvalide).problemes.map((p) => p.variable);
      for (const attendu of ['API_URL_PUBLIQUE', 'DATABASE_URL', 'REDIS_URL']) {
        expect(variablesFautives, `ErreurConfigInvalide doit lister ${attendu}`).toContain(attendu);
      }
    }
  });

  it('NODE_ENV=production avec COOKIE_SECURE=false est refusé (le cookie de session ne partirait jamais en HTTPS)', () => {
    const env = envValide({ NODE_ENV: 'production', COOKIE_SECURE: 'false' });
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });

  it('NODE_ENV=production avec COOKIE_SECURE=true est accepté', () => {
    const env = envValide({ NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    expect(() => chargerConfig(env)).not.toThrow();
  });

  it("DATABASE_URL identique à DATABASE_URL_MIGRATION est refusé (l'app tournerait avec le rôle qui peut modifier le schéma / contourner le RLS)", () => {
    const env = envValide();
    env.DATABASE_URL_MIGRATION = env.DATABASE_URL;
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });
});
