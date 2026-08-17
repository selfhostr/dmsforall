import { describe, expect, it } from 'vitest';

import {
  clotureAutomatiquePointageJobDoitEtreActif,
  type ConfigAvecJobClotureAutomatiquePointage,
} from './config-job-cloture-automatique-pointage';

function config(
  overrides: Partial<ConfigAvecJobClotureAutomatiquePointage> = {},
): ConfigAvecJobClotureAutomatiquePointage {
  return {
    NODE_ENV: 'development',
    POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: undefined,
    POINTAGE_CLOTURE_AUTOMATIQUE_JOB_CRON: '30 0 * * *',
    DATABASE_URL_MIGRATION: 'postgres://migrateur/dfa',
    ...overrides,
  };
}

describe('clotureAutomatiquePointageJobDoitEtreActif — défaut sûr = actif en prod, inactif ailleurs, forçage explicite prioritaire', () => {
  it('production, variable absente -> ACTIF (un technicien qui oublie de pointer sa sortie ne doit plus jamais rester "en cours" indéfiniment faute de variable posée)', () => {
    expect(
      clotureAutomatiquePointageJobDoitEtreActif(
        config({ NODE_ENV: 'production', POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: undefined }),
      ),
    ).toBe(true);
  });

  it.each(['development', 'test'] as const)(
    '%s, variable absente -> INACTIF (un poste de dev ne clôture pas les pointages de la seed par défaut)',
    (nodeEnv) => {
      expect(
        clotureAutomatiquePointageJobDoitEtreActif(
          config({ NODE_ENV: nodeEnv, POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: undefined }),
        ),
      ).toBe(false);
    },
  );

  it("forçage explicite 'true' en development -> ACTIF (un poste de dev peut tester le job)", () => {
    expect(
      clotureAutomatiquePointageJobDoitEtreActif(
        config({ NODE_ENV: 'development', POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: 'true' }),
      ),
    ).toBe(true);
  });

  it("forçage explicite 'false' en production -> INACTIF (couper le job en cas d'incident)", () => {
    expect(
      clotureAutomatiquePointageJobDoitEtreActif(
        config({ NODE_ENV: 'production', POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: 'false' }),
      ),
    ).toBe(false);
  });

  it("forçage explicite 'true' en production -> ACTIF (même résultat que le défaut, mais explicite)", () => {
    expect(
      clotureAutomatiquePointageJobDoitEtreActif(
        config({ NODE_ENV: 'production', POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: 'true' }),
      ),
    ).toBe(true);
  });

  it("forçage explicite 'false' hors production -> même résultat que le défaut, mais explicite", () => {
    expect(
      clotureAutomatiquePointageJobDoitEtreActif(
        config({ NODE_ENV: 'test', POINTAGE_CLOTURE_AUTOMATIQUE_JOB_ACTIF: 'false' }),
      ),
    ).toBe(false);
  });
});
