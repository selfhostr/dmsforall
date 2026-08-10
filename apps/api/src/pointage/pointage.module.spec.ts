import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from '../app.module';
import { chargerConfig } from '../config';

import { PinController } from './pin.controller';
import { PointagePeriodeController } from './pointage-periode.controller';
import { PointageController } from './pointage.controller';
import { PointageModule } from './pointage.module';

/**
 * Câblage du module Pointage — piège déjà rencontré sur ce dépôt (voir CONTRIBUTING.md « Pièges
 * vérifiés ») : un contrôleur qui compile mais n'est déclaré nulle part rend un 404 silencieux,
 * alors que tous les tests de service passent. Deux niveaux distincts, tous deux nécessaires :
 *
 *  1. Les trois contrôleurs de ce module sont bien dans `@Module({ controllers: [...] })` de
 *     `PointageModule` — sinon Nest ne monte tout simplement pas leurs routes.
 *  2. `PointageModule` lui-même est bien importé par `AppModule` — sinon même un module interne
 *     parfaitement câblé ne monte jamais rien. `common/droits/toutes-les-routes-decorees.spec.ts`
 *     et `toutes-les-actions-couvertes.spec.ts` marchent déjà le graphe RÉEL depuis `AppModule` et
 *     prouvent que toute route DÉCOUVERTE est décorée — mais si `PointageModule` n'était pas
 *     importé, ces routes ne seraient simplement jamais découvertes, et ces suites resteraient
 *     vertes sans avoir rien vérifié sur ce module précis. Ce fichier comble ce trou-là,
 *     localement, pour le seul périmètre pointage.
 */
const CONFIG_MINIMALE = chargerConfig({
  API_URL_PUBLIQUE: 'http://localhost:3000',
  WEB_URL_PUBLIQUE: 'http://localhost:5173',
  DATABASE_URL: 'postgres://app-scan-statique/db',
  DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
  REDIS_URL: 'redis://scan-statique',
});

describe('PointageModule — câblage réel (pas seulement compile)', () => {
  it('déclare PointageController, PointagePeriodeController et PinController dans ses controllers', () => {
    const controleurs = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PointageModule) as
      unknown[] | undefined;

    expect(controleurs).toBeDefined();
    expect(controleurs).toContain(PointageController);
    expect(controleurs).toContain(PointagePeriodeController);
    expect(controleurs).toContain(PinController);
  });

  it('AppModule importe réellement PointageModule (sinon aucune de ses routes ne monte jamais)', () => {
    const descripteurApp = AppModule.pourConfig(CONFIG_MINIMALE);
    const imports = (descripteurApp.imports ?? []) as unknown[];

    expect(imports).toContain(PointageModule);
  });
});
