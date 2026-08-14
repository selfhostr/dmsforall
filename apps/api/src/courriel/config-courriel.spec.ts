import { describe, expect, it } from 'vitest';

import { chargerConfig, ErreurConfigInvalide } from '../config';
import {
  courrielDoitEnvoyerReellement,
  ErreurConfigCourrielInvalide,
  resoudreConfigSmtp,
  type ConfigAvecCourriel,
} from './config-courriel';

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

describe('schéma SMTP fusionné dans chargerConfig', () => {
  it('les variables SMTP_* sont toutes absentes sans empêcher le démarrage (dev, même logique que SENTRY_DSN)', () => {
    const config = chargerConfig(envValide());
    expect(config.SMTP_HOTE).toBeUndefined();
    expect(config.SMTP_UTILISATEUR).toBeUndefined();
    expect(config.SMTP_MOT_DE_PASSE).toBeUndefined();
    expect(config.SMTP_EXPEDITEUR).toBeUndefined();
    expect(config.SMTP_PORT).toBe(587);
    expect(config.COURRIEL_ENVOI_REEL).toBe(false);
  });

  it('un port SMTP non entier est refusé (config invalide, l’API refuse de démarrer)', () => {
    const env = envValide({ SMTP_PORT: 'pas-un-port' });
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });

  it('une chaîne vide pour SMTP_EXPEDITEUR n’est pas prise pour une adresse invalide (préprocesseur, même patron que SENTRY_DSN)', () => {
    const config = chargerConfig(envValide({ SMTP_EXPEDITEUR: '' }));
    expect(config.SMTP_EXPEDITEUR).toBeUndefined();
  });

  it('SMTP_SECURISE="false" reste bien faux — piège maison de z.coerce.boolean() (issue #43), pas reproduit ici', () => {
    const config = chargerConfig(envValide({ SMTP_SECURISE: 'false' }));
    expect(config.SMTP_SECURISE).toBe(false);
  });

  it('SMTP_SECURISE="true" est bien vrai', () => {
    const config = chargerConfig(envValide({ SMTP_SECURISE: 'true' }));
    expect(config.SMTP_SECURISE).toBe(true);
  });

  it('COURRIEL_ENVOI_REEL="false" reste bien faux — même piège, même garde-fou', () => {
    const config = chargerConfig(envValide({ COURRIEL_ENVOI_REEL: 'false' }));
    expect(config.COURRIEL_ENVOI_REEL).toBe(false);
  });

  it('une valeur SMTP_SECURISE hors {true,false} est refusée plutôt que coercée au hasard', () => {
    const env = envValide({ SMTP_SECURISE: 'oui' });
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });

  it('un jeu complet de variables SMTP est accepté tel quel', () => {
    const config = chargerConfig(
      envValide({
        SMTP_HOTE: 'smtp.example.org',
        SMTP_PORT: '587',
        SMTP_SECURISE: 'false',
        SMTP_UTILISATEUR: 'no-reply@dmsforall.example',
        SMTP_MOT_DE_PASSE: 'un-secret-avec-des-$-dedans',
        SMTP_EXPEDITEUR: 'no-reply@dmsforall.example',
      }),
    );
    expect(config.SMTP_HOTE).toBe('smtp.example.org');
    expect(config.SMTP_EXPEDITEUR).toBe('no-reply@dmsforall.example');
  });
});

describe('courrielDoitEnvoyerReellement — seul point de décision entre transport réel et capture', () => {
  function config(surcharges: Partial<ConfigAvecCourriel> = {}): ConfigAvecCourriel {
    return {
      NODE_ENV: 'development',
      COURRIEL_ENVOI_REEL: false,
      SMTP_PORT: 587,
      SMTP_SECURISE: false,
      ...surcharges,
    };
  }

  it("le drapeau absent (défaut) n'active jamais l'envoi réel, quel que soit NODE_ENV", () => {
    expect(courrielDoitEnvoyerReellement(config({ NODE_ENV: 'production' }))).toBe(false);
  });

  it("le drapeau seul, activé HORS production, n'active jamais l'envoi réel — c'est le test le plus important", () => {
    expect(
      courrielDoitEnvoyerReellement(config({ NODE_ENV: 'development', COURRIEL_ENVOI_REEL: true })),
    ).toBe(false);
    expect(
      courrielDoitEnvoyerReellement(config({ NODE_ENV: 'test', COURRIEL_ENVOI_REEL: true })),
    ).toBe(false);
  });

  it('les deux clés réunies (production + drapeau) activent l’envoi réel', () => {
    expect(
      courrielDoitEnvoyerReellement(config({ NODE_ENV: 'production', COURRIEL_ENVOI_REEL: true })),
    ).toBe(true);
  });
});

describe('resoudreConfigSmtp — appelée uniquement quand l’envoi réel est demandé', () => {
  const CONFIG_COMPLETE: ConfigAvecCourriel = {
    NODE_ENV: 'production',
    COURRIEL_ENVOI_REEL: true,
    SMTP_HOTE: 'smtp.example.org',
    SMTP_PORT: 587,
    SMTP_SECURISE: false,
    SMTP_UTILISATEUR: 'no-reply@dmsforall.example',
    SMTP_MOT_DE_PASSE: 'secret',
    SMTP_EXPEDITEUR: 'no-reply@dmsforall.example',
  };

  it('rend les identifiants résolus quand tout est présent', () => {
    const smtp = resoudreConfigSmtp(CONFIG_COMPLETE);
    expect(smtp).toEqual({
      hote: 'smtp.example.org',
      port: 587,
      securise: false,
      utilisateur: 'no-reply@dmsforall.example',
      motDePasse: 'secret',
      expediteur: 'no-reply@dmsforall.example',
    });
  });

  it('lève ErreurConfigCourrielInvalide si un identifiant manque', () => {
    const { SMTP_HOTE: _ignore, ...sansHote } = CONFIG_COMPLETE;
    expect(() => resoudreConfigSmtp(sansHote)).toThrow(ErreurConfigCourrielInvalide);
  });

  it('liste TOUTES les variables manquantes, pas seulement la première', () => {
    const incomplete: ConfigAvecCourriel = {
      NODE_ENV: 'production',
      COURRIEL_ENVOI_REEL: true,
      SMTP_PORT: 587,
      SMTP_SECURISE: false,
    };
    expect.assertions(1);
    try {
      resoudreConfigSmtp(incomplete);
    } catch (erreur) {
      expect((erreur as ErreurConfigCourrielInvalide).problemes).toHaveLength(4);
    }
  });
});
