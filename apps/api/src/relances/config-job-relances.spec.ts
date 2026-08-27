import { describe, expect, it } from 'vitest';

import { relancesFactureJobDoitEtreActif, type ConfigAvecJobRelances } from './config-job-relances';

function config(overrides: Partial<ConfigAvecJobRelances> = {}): ConfigAvecJobRelances {
  return {
    NODE_ENV: 'development',
    RELANCES_FACTURE_JOB_ACTIF: undefined,
    RELANCES_FACTURE_JOB_CRON: '12 * * * *',
    DATABASE_URL_MIGRATION: 'postgres://migrateur/dfa',
    ...overrides,
  };
}

describe('relancesFactureJobDoitEtreActif — défaut sûr = actif en prod, inactif ailleurs, forçage explicite prioritaire', () => {
  it('production, variable absente -> ACTIF (un garage ne doit plus jamais rester sans relance faute de variable posée)', () => {
    expect(
      relancesFactureJobDoitEtreActif(
        config({ NODE_ENV: 'production', RELANCES_FACTURE_JOB_ACTIF: undefined }),
      ),
    ).toBe(true);
  });

  it.each(['development', 'test'] as const)(
    '%s, variable absente -> INACTIF (un poste de dev ne relance pas les factures de la seed par défaut)',
    (nodeEnv) => {
      expect(
        relancesFactureJobDoitEtreActif(
          config({ NODE_ENV: nodeEnv, RELANCES_FACTURE_JOB_ACTIF: undefined }),
        ),
      ).toBe(false);
    },
  );

  it("forçage explicite 'true' en development -> ACTIF (un poste de dev peut tester le job)", () => {
    expect(
      relancesFactureJobDoitEtreActif(
        config({ NODE_ENV: 'development', RELANCES_FACTURE_JOB_ACTIF: 'true' }),
      ),
    ).toBe(true);
  });

  it("forçage explicite 'false' en production -> INACTIF (couper le job en cas d'incident)", () => {
    expect(
      relancesFactureJobDoitEtreActif(
        config({ NODE_ENV: 'production', RELANCES_FACTURE_JOB_ACTIF: 'false' }),
      ),
    ).toBe(false);
  });

  it("forçage explicite 'true' en production -> ACTIF (même résultat que le défaut, mais explicite)", () => {
    expect(
      relancesFactureJobDoitEtreActif(
        config({ NODE_ENV: 'production', RELANCES_FACTURE_JOB_ACTIF: 'true' }),
      ),
    ).toBe(true);
  });

  it("forçage explicite 'false' hors production -> même résultat que le défaut, mais explicite", () => {
    expect(
      relancesFactureJobDoitEtreActif(
        config({ NODE_ENV: 'test', RELANCES_FACTURE_JOB_ACTIF: 'false' }),
      ),
    ).toBe(false);
  });
});
