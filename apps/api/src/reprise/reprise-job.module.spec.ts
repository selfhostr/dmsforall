import { describe, expect, it } from 'vitest';

import { chargerConfig } from '../config';

import { ProcesseurAnalyseReprise } from './analyse/processeur-analyse-reprise';
import { ProcesseurImportReprise } from './import/processeur-import-reprise';
import { RepriseJobModule } from './reprise-job.module';
import { RepriseModule } from './reprise.module';

/**
 * Preuve directe sur le descripteur `DynamicModule` RÉEL rendu par `.pourConfig(...)` — voir
 * `ordonnancement/app-module-mode-processus.spec.ts` pour la preuve équivalente au niveau du
 * graphe complet de l'application (celle qui compte pour l'exigence 1 du chantier).
 */
function config(modeProcessus: 'api' | 'worker' | 'combine') {
  return chargerConfig({
    API_URL_PUBLIQUE: 'http://localhost:3000',
    WEB_URL_PUBLIQUE: 'http://localhost:5173',
    DATABASE_URL: 'postgres://app-scan-statique/db',
    DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
    REDIS_URL: 'redis://scan-statique',
    MODE_PROCESSUS: modeProcessus,
  });
}

describe('RepriseJobModule.pourConfig', () => {
  it("mode 'api' : descripteur vide — aucun provider, aucun import", () => {
    const descripteur = RepriseJobModule.pourConfig(config('api'));

    expect(descripteur.imports ?? []).toHaveLength(0);
    expect(descripteur.providers ?? []).toHaveLength(0);
  });

  it("mode 'worker' : les deux processeurs sont déclarés, RepriseModule importé (forme statique)", () => {
    const descripteur = RepriseJobModule.pourConfig(config('worker'));

    expect(descripteur.providers ?? []).toContain(ProcesseurAnalyseReprise);
    expect(descripteur.providers ?? []).toContain(ProcesseurImportReprise);
    // Forme STATIQUE (classe nue), jamais `.pourConfig(...)` — voir l'en-tête du module pour le
    // risque de double-instanciation sinon (`RepriseModule` est aussi importé, en forme statique,
    // par `exploitation/cycle-vie-tenant/cycle-vie-tenant.module.ts`).
    expect(descripteur.imports ?? []).toContain(RepriseModule);
  });

  it("mode 'combine' : même contenu qu'en mode worker", () => {
    const descripteur = RepriseJobModule.pourConfig(config('combine'));

    expect(descripteur.providers ?? []).toContain(ProcesseurAnalyseReprise);
    expect(descripteur.providers ?? []).toContain(ProcesseurImportReprise);
  });
});
