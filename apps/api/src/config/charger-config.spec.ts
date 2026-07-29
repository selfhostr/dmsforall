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

describe('finding D-01 (audit sécurité) — LIMITE_RECHERCHE_UTILISATEUR / LIMITE_RECHERCHE_FENETRE_SECONDES configurables', () => {
  it('les valeurs par défaut (40 requêtes / 30 s) sont chargées sans erreur', () => {
    const config = chargerConfig(envValide());
    expect(config.LIMITE_RECHERCHE_UTILISATEUR).toBe(40);
    expect(config.LIMITE_RECHERCHE_FENETRE_SECONDES).toBe(30);
  });

  it('accepte une valeur personnalisée pour dimensionner la limitation de débit de la recherche', () => {
    const config = chargerConfig(
      envValide({ LIMITE_RECHERCHE_UTILISATEUR: '80', LIMITE_RECHERCHE_FENETRE_SECONDES: '60' }),
    );
    expect(config.LIMITE_RECHERCHE_UTILISATEUR).toBe(80);
    expect(config.LIMITE_RECHERCHE_FENETRE_SECONDES).toBe(60);
  });

  it('refuse LIMITE_RECHERCHE_UTILISATEUR à zéro ou négative (le budget doit rester consommable)', () => {
    const env = envValide({ LIMITE_RECHERCHE_UTILISATEUR: '0' });
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });

  it('refuse LIMITE_RECHERCHE_FENETRE_SECONDES à zéro ou négative (fenêtre glissante non nulle exigée)', () => {
    const env = envValide({ LIMITE_RECHERCHE_FENETRE_SECONDES: '0' });
    expect(() => chargerConfig(env)).toThrow(ErreurConfigInvalide);
  });
});

describe('finding M4 (audit sécurité) — refus des mots de passe de dev (dfa_app_dev/dfa_migrator_dev) en production', () => {
  it('accepte les identifiants de dev en développement (usage légitime, dev/CI)', () => {
    const env = envValide({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://dfa_app:dfa_app_dev@localhost:5432/dfa_dev',
      DATABASE_URL_MIGRATION: 'postgresql://dfa_migrator:dfa_migrator_dev@localhost:5432/dfa_dev',
      COOKIE_SECURE: 'false',
    });
    expect(() => chargerConfig(env)).not.toThrow();
  });

  it('refuse DATABASE_URL portant le mot de passe de dev dfa_app_dev en production', () => {
    const env = envValide({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://dfa_app:dfa_app_dev@db.prod.dmsforall.example:5432/dfa_prod',
      DATABASE_URL_MIGRATION: 'postgresql://dfa_migrator:un-mot-de-passe-fort@db.prod.dmsforall.example:5432/dfa_prod',
      COOKIE_SECURE: 'true',
    });
    expect.assertions(2);
    try {
      chargerConfig(env);
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurConfigInvalide);
      const variablesFautives = (erreur as ErreurConfigInvalide).problemes.map((p) => p.variable);
      expect(variablesFautives).toContain('DATABASE_URL');
    }
  });

  it('refuse DATABASE_URL_MIGRATION portant le mot de passe de dev dfa_migrator_dev en production', () => {
    const env = envValide({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://dfa_app:un-mot-de-passe-fort@db.prod.dmsforall.example:5432/dfa_prod',
      DATABASE_URL_MIGRATION: 'postgresql://dfa_migrator:dfa_migrator_dev@db.prod.dmsforall.example:5432/dfa_prod',
      COOKIE_SECURE: 'true',
    });
    expect.assertions(2);
    try {
      chargerConfig(env);
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurConfigInvalide);
      const variablesFautives = (erreur as ErreurConfigInvalide).problemes.map((p) => p.variable);
      expect(variablesFautives).toContain('DATABASE_URL_MIGRATION');
    }
  });

  it('le message d\'erreur renvoie vers la procédure de rotation (docs/deploiement-production.md §3.2)', () => {
    const env = envValide({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://dfa_app:dfa_app_dev@db.prod.dmsforall.example:5432/dfa_prod',
      DATABASE_URL_MIGRATION: 'postgresql://dfa_migrator:un-mot-de-passe-fort@db.prod.dmsforall.example:5432/dfa_prod',
      COOKIE_SECURE: 'true',
    });
    expect.assertions(1);
    try {
      chargerConfig(env);
    } catch (erreur) {
      const messages = (erreur as ErreurConfigInvalide).problemes.map((p) => p.message).join(' ');
      expect(messages).toContain('docs/deploiement-production.md §3.2');
    }
  });

  it('accepte des mots de passe forts en production, sans trace des identifiants de dev', () => {
    const env = envValide({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://dfa_app:un-mot-de-passe-fort@db.prod.dmsforall.example:5432/dfa_prod',
      DATABASE_URL_MIGRATION: 'postgresql://dfa_migrator:un-autre-mot-de-passe-fort@db.prod.dmsforall.example:5432/dfa_prod',
      COOKIE_SECURE: 'true',
    });
    expect(() => chargerConfig(env)).not.toThrow();
  });
});
