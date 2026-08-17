import { describe, expect, it } from 'vitest';

import {
  referentielVehiculesChJobDoitEtreActif,
  type ConfigAvecJobReferentielVehiculesCh,
} from './config-job-referentiel-vehicules-ch';

function config(
  overrides: Partial<ConfigAvecJobReferentielVehiculesCh> = {},
): ConfigAvecJobReferentielVehiculesCh {
  return {
    NODE_ENV: 'development',
    REFERENTIEL_VEHICULES_CH_JOB_ACTIF: undefined,
    REFERENTIEL_VEHICULES_CH_JOB_CRON: '17 4 * * *',
    DATABASE_URL_MIGRATION: 'postgres://migrateur/dfa',
    ...overrides,
  };
}

describe('referentielVehiculesChJobDoitEtreActif — défaut sûr = actif en prod, inactif ailleurs, forçage explicite prioritaire', () => {
  it('production, variable absente -> ACTIF (correctif du 17.08.2026 : plus jamais oublié)', () => {
    expect(
      referentielVehiculesChJobDoitEtreActif(
        config({ NODE_ENV: 'production', REFERENTIEL_VEHICULES_CH_JOB_ACTIF: undefined }),
      ),
    ).toBe(true);
  });

  it.each(['development', 'test'] as const)(
    '%s, variable absente -> INACTIF (un poste de dev ne martèle pas admin.ch par défaut)',
    (nodeEnv) => {
      expect(
        referentielVehiculesChJobDoitEtreActif(
          config({ NODE_ENV: nodeEnv, REFERENTIEL_VEHICULES_CH_JOB_ACTIF: undefined }),
        ),
      ).toBe(false);
    },
  );

  it("forçage explicite 'true' en development -> ACTIF (un poste de dev peut tester le job)", () => {
    expect(
      referentielVehiculesChJobDoitEtreActif(
        config({ NODE_ENV: 'development', REFERENTIEL_VEHICULES_CH_JOB_ACTIF: 'true' }),
      ),
    ).toBe(true);
  });

  it("forçage explicite 'false' en production -> INACTIF (couper le job en cas d'incident chez l'ASTRA)", () => {
    expect(
      referentielVehiculesChJobDoitEtreActif(
        config({ NODE_ENV: 'production', REFERENTIEL_VEHICULES_CH_JOB_ACTIF: 'false' }),
      ),
    ).toBe(false);
  });

  it("forçage explicite 'true' en production -> ACTIF (même résultat que le défaut, mais explicite)", () => {
    expect(
      referentielVehiculesChJobDoitEtreActif(
        config({ NODE_ENV: 'production', REFERENTIEL_VEHICULES_CH_JOB_ACTIF: 'true' }),
      ),
    ).toBe(true);
  });

  it("forçage explicite 'false' hors production -> même résultat que le défaut, mais explicite", () => {
    expect(
      referentielVehiculesChJobDoitEtreActif(
        config({ NODE_ENV: 'test', REFERENTIEL_VEHICULES_CH_JOB_ACTIF: 'false' }),
      ),
    ).toBe(false);
  });
});
