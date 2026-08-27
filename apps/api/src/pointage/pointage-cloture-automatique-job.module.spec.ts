import { describe, expect, it } from 'vitest';
import { BullModule } from '@nestjs/bullmq';

import { chargerConfig } from '../config';

import { PointageClotureAutomatiqueJobModule } from './pointage-cloture-automatique-job.module';
import { OrdonnanceurClotureAutomatiquePointage } from './ordonnanceur-cloture-automatique-pointage';
import { ProcesseurClotureAutomatiquePointage } from './processeur-cloture-automatique-pointage';
import { ServiceJobClotureAutomatiquePointage } from './service-job-cloture-automatique-pointage';

/**
 * Preuve directe sur le descripteur `DynamicModule` RÉEL rendu par `.pourConfig(...)` — pas une
 * lecture de source : c'est exactement l'objet que Nest consomme pour construire son graphe
 * (`ModuleCompiler.extractMetadata`, `@nestjs/core`). Voir `ordonnancement/app-module-mode-
 * processus.spec.ts` pour la preuve équivalente au niveau du graphe complet de l'application.
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

describe('PointageClotureAutomatiqueJobModule.pourConfig', () => {
  it("mode 'api' : descripteur vide — aucun provider, aucune file BullMQ", () => {
    const descripteur = PointageClotureAutomatiqueJobModule.pourConfig(config('api'));

    expect(descripteur.imports ?? []).toHaveLength(0);
    expect(descripteur.providers ?? []).toHaveLength(0);
  });

  it("mode 'worker' : le processeur, l'ordonnanceur et la file BullMQ sont bien déclarés", () => {
    const descripteur = PointageClotureAutomatiqueJobModule.pourConfig(config('worker'));
    const providers = descripteur.providers ?? [];
    const imports = descripteur.imports ?? [];

    expect(providers).toContain(ProcesseurClotureAutomatiquePointage);
    expect(providers).toContain(OrdonnanceurClotureAutomatiquePointage);
    expect(providers).toContain(ServiceJobClotureAutomatiquePointage);
    expect(
      imports.some(
        (i) => typeof i === 'object' && i !== null && 'module' in i && i.module === BullModule,
      ),
    ).toBe(true);
  });

  it("mode 'combine' : même contenu qu'en mode worker (défaut de développement)", () => {
    const descripteur = PointageClotureAutomatiqueJobModule.pourConfig(config('combine'));

    expect(descripteur.providers ?? []).toContain(ProcesseurClotureAutomatiquePointage);
  });
});
