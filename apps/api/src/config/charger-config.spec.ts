/**
 * Test unitaire colocalisé, propriété expert-auth (`apps/api/src/config/charger-config.ts` est
 * dans son périmètre exclusif). Complète `apps/api/test/integration/config.spec.ts` (propriété
 * d'un autre agent) sans le modifier : ce fichier couvre spécifiquement le garde-fou ajouté pour
 * le bloquant B1 (rapport QA étape 0).
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

describe('bloquant B1 (rapport QA étape 0) — LIMITE_CONNEXION_COMPTE doit rester au-dessus de SEUIL_VERROUILLAGE_COMPTE', () => {
  it('les valeurs par défaut (15 et 5) sont chargées sans erreur et respectent déjà la règle', () => {
    const config = chargerConfig(envValide());
    expect(config.LIMITE_CONNEXION_COMPTE).toBe(15);
    expect(config.SEUIL_VERROUILLAGE_COMPTE).toBe(5);
  });

  it('LIMITE_CONNEXION_COMPTE égale à SEUIL_VERROUILLAGE_COMPTE est refusée (423 deviendrait inatteignable)', () => {
    const env = envValide({ LIMITE_CONNEXION_COMPTE: '5', SEUIL_VERROUILLAGE_COMPTE: '5' });
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });

  it('LIMITE_CONNEXION_COMPTE strictement inférieure à SEUIL_VERROUILLAGE_COMPTE est refusée', () => {
    const env = envValide({ LIMITE_CONNEXION_COMPTE: '3', SEUIL_VERROUILLAGE_COMPTE: '5' });
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });

  it('LIMITE_CONNEXION_COMPTE strictement supérieure à SEUIL_VERROUILLAGE_COMPTE est acceptée', () => {
    const env = envValide({ LIMITE_CONNEXION_COMPTE: '6', SEUIL_VERROUILLAGE_COMPTE: '5' });
    expect(() => chargerConfig(env)).not.toThrow();
  });

  it('la variable fautive listée dans ErreurConfigInvalide est LIMITE_CONNEXION_COMPTE', () => {
    const env = envValide({ LIMITE_CONNEXION_COMPTE: '5', SEUIL_VERROUILLAGE_COMPTE: '5' });
    expect.assertions(2);
    try {
      chargerConfig(env);
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurConfigInvalide);
      const variablesFautives = (erreur as ErreurConfigInvalide).problemes.map((p) => p.variable);
      expect(variablesFautives).toContain('LIMITE_CONNEXION_COMPTE');
    }
  });
});
