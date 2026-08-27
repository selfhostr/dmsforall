import type { DynamicModule } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AppModule } from '../app.module';
import { chargerConfig, type Config } from '../config';
import { OrdonnanceurClotureAutomatiquePointage } from '../pointage/ordonnanceur-cloture-automatique-pointage';
import { ProcesseurClotureAutomatiquePointage } from '../pointage/processeur-cloture-automatique-pointage';
import { ProcesseurAnalyseReprise } from '../reprise/analyse/processeur-analyse-reprise';
import { ProcesseurImportReprise } from '../reprise/import/processeur-import-reprise';
import { OrdonnanceurPurgeAutomatiqueTenant } from '../exploitation/cycle-vie-tenant/ordonnanceur-purge-automatique-tenant';
import { ProcesseurExportResiliationTenant } from '../exploitation/cycle-vie-tenant/processeur-export-resiliation';
import { ProcesseurPurgeAutomatiqueTenant } from '../exploitation/cycle-vie-tenant/processeur-purge-automatique-tenant';
import { OrdonnanceurReferentielVehiculesCh } from '../vehicules/referentiel/ordonnanceur-referentiel-vehicules-ch';
import { ProcesseurReferentielVehiculesCh } from '../vehicules/referentiel/processeur-referentiel-vehicules-ch';

/**
 * PREUVE DE L'EXIGENCE 1 du chantier « découplage worker/API » (27.08.2026) : « en mode API,
 * aucun processeur ne doit être instancié — pas seulement inactif : pas enregistré ».
 *
 * Aucune instanciation Nest ici (pas de `Test.createTestingModule().compile()`, pas de DB/Redis) —
 * mais PAS non plus une lecture de source : `aplatirProviders` rejoue EXACTEMENT le mécanisme que
 * `@nestjs/core` utilise pour construire son graphe (`ModuleCompiler.extractMetadata` :
 * métadonnée `@Module(...)` du `type` + propriétés du `DynamicModule` s'il y en a un — voir
 * `node_modules/@nestjs/core/injector/compiler.js`), appliqué RÉCURSIVEMENT sur le graphe RÉEL
 * rendu par `AppModule.pourConfig(config)`. Si un `@Processor` apparaît dans le résultat, Nest
 * l'instancierait ; s'il n'y apparaît PAS, Nest ne peut structurellement pas le découvrir
 * (`BullExplorer.registerWorkers`, `@nestjs/bullmq`, scanne `DiscoveryService.getProviders()` —
 * qui ne connaît QUE ce que le graphe de modules a effectivement enregistré).
 */

function estDynamicModule(valeur: unknown): valeur is DynamicModule {
  return typeof valeur === 'object' && valeur !== null && 'module' in valeur;
}

function aplatirProviders(racine: unknown, visites = new Set<unknown>()): unknown[] {
  const cls = estDynamicModule(racine) ? racine.module : racine;
  if (visites.has(cls)) {
    return [];
  }
  visites.add(cls);

  const providersStatiques = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, cls as object) ??
    []) as unknown[];
  const importsStatiques = (Reflect.getMetadata(MODULE_METADATA.IMPORTS, cls as object) ??
    []) as unknown[];
  const providersDynamiques = estDynamicModule(racine) ? (racine.providers ?? []) : [];
  const importsDynamiques = estDynamicModule(racine) ? (racine.imports ?? []) : [];

  const providers = [...providersStatiques, ...providersDynamiques];
  for (const imp of [...importsStatiques, ...importsDynamiques]) {
    providers.push(...aplatirProviders(imp, visites));
  }
  return providers;
}

function config(modeProcessus: Config['MODE_PROCESSUS']): Config {
  return chargerConfig({
    API_URL_PUBLIQUE: 'http://localhost:3000',
    WEB_URL_PUBLIQUE: 'http://localhost:5173',
    DATABASE_URL: 'postgres://app-scan-statique/db',
    DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
    REDIS_URL: 'redis://scan-statique',
    MODE_PROCESSUS: modeProcessus,
  });
}

const LES_SIX_PROCESSEURS = [
  ProcesseurClotureAutomatiquePointage,
  ProcesseurAnalyseReprise,
  ProcesseurImportReprise,
  ProcesseurExportResiliationTenant,
  ProcesseurPurgeAutomatiqueTenant,
  ProcesseurReferentielVehiculesCh,
] as const;

const LES_TROIS_ORDONNANCEURS = [
  OrdonnanceurClotureAutomatiquePointage,
  OrdonnanceurPurgeAutomatiqueTenant,
  OrdonnanceurReferentielVehiculesCh,
] as const;

describe('AppModule — graphe réel des processeurs BullMQ par MODE_PROCESSUS', () => {
  it("mode 'api' : AUCUN des six `@Processor` n'apparaît dans le graphe (pas seulement inactif)", () => {
    const providers = aplatirProviders(AppModule.pourConfig(config('api')));

    for (const Processeur of LES_SIX_PROCESSEURS) {
      expect(
        providers,
        `${Processeur.name} ne doit pas être dans le graphe en mode 'api'`,
      ).not.toContain(Processeur);
    }
  });

  it("mode 'api' : aucun des trois ordonnanceurs (`OnApplicationBootstrap`) non plus", () => {
    const providers = aplatirProviders(AppModule.pourConfig(config('api')));

    for (const Ordonnanceur of LES_TROIS_ORDONNANCEURS) {
      expect(
        providers,
        `${Ordonnanceur.name} ne doit pas être dans le graphe en mode 'api'`,
      ).not.toContain(Ordonnanceur);
    }
  });

  it("mode 'worker' : les six `@Processor` sont bien dans le graphe", () => {
    const providers = aplatirProviders(AppModule.pourConfig(config('worker')));

    for (const Processeur of LES_SIX_PROCESSEURS) {
      expect(providers, `${Processeur.name} doit être dans le graphe en mode 'worker'`).toContain(
        Processeur,
      );
    }
  });

  it("mode 'combine' (défaut de développement) : les six `@Processor` sont bien dans le graphe", () => {
    const providers = aplatirProviders(AppModule.pourConfig(config('combine')));

    for (const Processeur of LES_SIX_PROCESSEURS) {
      expect(providers, `${Processeur.name} doit être dans le graphe en mode 'combine'`).toContain(
        Processeur,
      );
    }
  });

  it("défaut de chargerConfig (aucun MODE_PROCESSUS posé) : équivaut à 'combine' — pnpm dev inchangé", () => {
    const configDefaut = chargerConfig({
      API_URL_PUBLIQUE: 'http://localhost:3000',
      WEB_URL_PUBLIQUE: 'http://localhost:5173',
      DATABASE_URL: 'postgres://app-scan-statique/db',
      DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
      REDIS_URL: 'redis://scan-statique',
    });

    expect(configDefaut.MODE_PROCESSUS).toBe('combine');

    const providers = aplatirProviders(AppModule.pourConfig(configDefaut));
    expect(providers).toContain(ProcesseurClotureAutomatiquePointage);
  });
});
