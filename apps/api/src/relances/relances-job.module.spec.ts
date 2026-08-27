import { describe, expect, it } from 'vitest';
import { BullModule } from '@nestjs/bullmq';

import { chargerConfig } from '../config';

import { RelancesJobModule } from './relances-job.module';
import { OrdonnanceurRelancesFacture } from './ordonnanceur-relances-facture';
import { ProcesseurRelancesFacture } from './processeur-relances-facture';
import { ServiceJobRelancesFacture } from './service-job-relances-facture';

/**
 * Preuve directe sur le descripteur `DynamicModule` RÉEL rendu par `.pourConfig(...)` — pas une
 * lecture de source, même patron que `pointage/pointage-cloture-automatique-job.module.spec.ts`
 * (modèle) : c'est exactement l'objet que Nest consomme pour construire son graphe.
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

describe('RelancesJobModule.pourConfig', () => {
  it("mode 'api' : descripteur vide — aucun provider, aucune file BullMQ", () => {
    const descripteur = RelancesJobModule.pourConfig(config('api'));

    expect(descripteur.imports ?? []).toHaveLength(0);
    expect(descripteur.providers ?? []).toHaveLength(0);
  });

  it("mode 'worker' : le processeur, l'ordonnanceur et la file BullMQ sont bien déclarés", () => {
    const descripteur = RelancesJobModule.pourConfig(config('worker'));
    const providers = descripteur.providers ?? [];
    const imports = descripteur.imports ?? [];

    expect(providers).toContain(ProcesseurRelancesFacture);
    expect(providers).toContain(OrdonnanceurRelancesFacture);
    expect(providers).toContain(ServiceJobRelancesFacture);
    expect(
      imports.some(
        (i) => typeof i === 'object' && i !== null && 'module' in i && i.module === BullModule,
      ),
    ).toBe(true);
  });

  it("mode 'combine' : même contenu qu'en mode worker (défaut de développement)", () => {
    const descripteur = RelancesJobModule.pourConfig(config('combine'));

    expect(descripteur.providers ?? []).toContain(ProcesseurRelancesFacture);
  });
});
