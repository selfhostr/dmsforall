import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from '../app.module';
import { chargerConfig } from '../config';
import { ConnecteursModule } from '../connecteurs/connecteurs.module';

import { RelancesController } from './relances.controller';
import { RelancesModule } from './relances.module';

/**
 * Câblage du module Relances — même défaut potentiel que `pointage.module.spec.ts` (voir son
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

describe('RelancesModule — câblage réel (pas seulement compile)', () => {
  it('déclare RelancesController dans ses controllers', () => {
    const controleurs = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RelancesModule) as
      unknown[] | undefined;

    expect(controleurs).toBeDefined();
    expect(controleurs).toContain(RelancesController);
  });

  it('importe ConnecteursModule (ServiceRelancesFacture en a besoin pour résoudre NotificationSender)', () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, RelancesModule) as
      unknown[] | undefined;

    expect(imports).toBeDefined();
    expect(imports).toContain(ConnecteursModule);
  });

  it('AppModule importe réellement RelancesModule (sinon aucune de ses routes ne monte jamais)', () => {
    const descripteurApp = AppModule.pourConfig(CONFIG_MINIMALE);
    const imports = (descripteurApp.imports ?? []) as unknown[];

    expect(imports).toContain(RelancesModule);
  });
});
