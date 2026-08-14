import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from '../app.module';
import { chargerConfig } from '../config';

import { ReferentielVehiculesChController } from './referentiel/referentiel-vehicules-ch.controller';
import { VehiculeController } from './vehicule.controller';
import { VehiculeDetentionController } from './vehicule-detention.controller';
import { VehiculeExpertiseController } from './vehicule-expertise.controller';
import { VehiculeKilometrageController } from './vehicule-kilometrage.controller';
import { VehiculePlaqueController } from './vehicule-plaque.controller';
import { VehiculeTravailReporteController } from './vehicule-travail-reporte.controller';
import { VehiculesModule } from './vehicules.module';

/**
 * Câblage du module Véhicules — même piège que `pointage/pointage.module.spec.ts` (voir
 * CONTRIBUTING.md « Pièges vérifiés ») : un contrôleur qui compile mais n'est déclaré nulle part rend
 * un 404 silencieux, alors que tous les tests de service passent. Ce fichier n'existait pas
 * encore pour `VehiculesModule` — ajouté ici à l'occasion du référentiel véhicules suisse
 * (`ReferentielVehiculesChController`), mais couvre tous les contrôleurs déjà déclarés pour ne
 * pas laisser le module sans ce filet.
 *
 * Deux niveaux distincts, tous deux nécessaires :
 *  1. `ReferentielVehiculesChController` (et les autres) bien dans
 *     `@Module({ controllers: [...] })` de `VehiculesModule` — sinon Nest ne monte tout
 *     simplement pas ses routes.
 *  2. `VehiculesModule` lui-même bien importé par `AppModule` — sinon même un module interne
 *     parfaitement câblé ne monte jamais rien.
 */
const CONFIG_MINIMALE = chargerConfig({
  API_URL_PUBLIQUE: 'http://localhost:3000',
  WEB_URL_PUBLIQUE: 'http://localhost:5173',
  DATABASE_URL: 'postgres://app-scan-statique/db',
  DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
  REDIS_URL: 'redis://scan-statique',
});

describe('VehiculesModule — câblage réel (pas seulement compile)', () => {
  it('déclare tous les contrôleurs véhicules, y compris ReferentielVehiculesChController', () => {
    const controleurs = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, VehiculesModule) as
      unknown[] | undefined;

    expect(controleurs).toBeDefined();
    expect(controleurs).toContain(VehiculeController);
    expect(controleurs).toContain(VehiculeDetentionController);
    expect(controleurs).toContain(VehiculeExpertiseController);
    expect(controleurs).toContain(VehiculeKilometrageController);
    expect(controleurs).toContain(VehiculePlaqueController);
    expect(controleurs).toContain(VehiculeTravailReporteController);
    expect(controleurs).toContain(ReferentielVehiculesChController);
  });

  it('AppModule importe réellement VehiculesModule (sinon aucune de ses routes ne monte jamais)', () => {
    const descripteurApp = AppModule.pourConfig(CONFIG_MINIMALE);
    const imports = (descripteurApp.imports ?? []) as unknown[];

    expect(imports).toContain(VehiculesModule);
  });
});
