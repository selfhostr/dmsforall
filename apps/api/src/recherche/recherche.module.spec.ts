import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from '../app.module';
import { chargerConfig } from '../config';

import { RechercheController } from './recherche.controller';
import { RechercheModule } from './recherche.module';

/**
 * Câblage du module Recherche — même défaut potentiel que `pointage.module.spec.ts` (voir son
 * en-tête pour le raisonnement complet) : un contrôleur non déclaré, ou un module non importé par
 * `AppModule`, rend un 404 silencieux malgré des tests de service verts.
 */
const CONFIG_MINIMALE = chargerConfig({
  API_URL_PUBLIQUE: 'http://localhost:3000',
  WEB_URL_PUBLIQUE: 'http://localhost:5173',
  DATABASE_URL: 'postgres://app-scan-statique/db',
  DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
  REDIS_URL: 'redis://scan-statique',
});

describe('RechercheModule — câblage réel (pas seulement compile)', () => {
  it('déclare RechercheController dans ses controllers', () => {
    const controleurs = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RechercheModule) as
      unknown[] | undefined;

    expect(controleurs).toBeDefined();
    expect(controleurs).toContain(RechercheController);
  });

  it('AppModule importe réellement RechercheModule (sinon aucune de ses routes ne monte jamais)', () => {
    const descripteurApp = AppModule.pourConfig(CONFIG_MINIMALE);
    const imports = (descripteurApp.imports ?? []) as unknown[];

    expect(imports).toContain(RechercheModule);
  });
});
