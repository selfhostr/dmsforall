import { describe, expect, it } from 'vitest';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { AppModule } from '../app.module';
import { chargerConfig } from '../config';

import { MotifsRendezVousController } from './motifs-rendez-vous.controller';
import { RendezVousController } from './rendez-vous.controller';
import { RendezVousTransitionsController } from './rendez-vous-transitions.controller';
import { RendezVousModule } from './rendezvous.module';

/**
 * Câblage du module RendezVous — piège déjà rencontré sur ce dépôt (voir CONTRIBUTING.md « Pièges
 * vérifiés ») : un contrôleur qui compile mais n'est déclaré nulle part rend un 404 silencieux,
 * alors que tous les tests de service passent. Deux niveaux distincts, tous deux nécessaires,
 * même patron que `pointage/pointage.module.spec.ts` :
 *
 *  1. Les trois contrôleurs de ce module sont bien dans `@Module({ controllers: [...] })`.
 *  2. `RendezVousModule` lui-même est bien importé par `AppModule` — sinon même un module interne
 *     parfaitement câblé ne monte jamais rien.
 */
const CONFIG_MINIMALE = chargerConfig({
  API_URL_PUBLIQUE: 'http://localhost:3000',
  WEB_URL_PUBLIQUE: 'http://localhost:5173',
  DATABASE_URL: 'postgres://app-scan-statique/db',
  DATABASE_URL_MIGRATION: 'postgres://migrateur-scan-statique/db',
  REDIS_URL: 'redis://scan-statique',
});

describe('RendezVousModule — câblage réel (pas seulement compile)', () => {
  it('déclare MotifsRendezVousController, RendezVousController et RendezVousTransitionsController dans ses controllers', () => {
    const controleurs = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RendezVousModule) as
      unknown[] | undefined;

    expect(controleurs).toBeDefined();
    expect(controleurs).toContain(MotifsRendezVousController);
    expect(controleurs).toContain(RendezVousController);
    expect(controleurs).toContain(RendezVousTransitionsController);
  });

  it('AppModule importe réellement RendezVousModule (sinon aucune de ses routes ne monte jamais)', () => {
    const descripteurApp = AppModule.pourConfig(CONFIG_MINIMALE);
    const imports = (descripteurApp.imports ?? []) as unknown[];

    expect(imports).toContain(RendezVousModule);
  });
});
