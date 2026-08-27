import { describe, expect, it } from 'vitest';

import { chargerConfig } from '../../config';

import { OrdonnanceurReferentielVehiculesCh } from './ordonnanceur-referentiel-vehicules-ch';
import { ProcesseurReferentielVehiculesCh } from './processeur-referentiel-vehicules-ch';
import { ReferentielVehiculesChJobModule } from './referentiel-vehicules-ch-job.module';
import { ServiceJobReferentielVehiculesCh } from './service-job-referentiel-vehicules-ch';

/**
 * Preuve directe sur le descripteur `DynamicModule` RÉEL rendu par `.pourConfig(...)` — voir
 * `ordonnancement/app-module-mode-processus.spec.ts` pour la preuve équivalente au niveau du
 * graphe complet de l'application (celle qui compte pour l'exigence 1 du chantier).
 *
 * Couvre aussi le risque identifié dans l'en-tête du module : AVANT ce chantier, la logique de
 * planification vivait directement sur la classe `ReferentielVehiculesChJobModule` (constructeur
 * + `OnApplicationBootstrap`) — un module Nest exécute TOUJOURS son propre constructeur dès qu'il
 * apparaît dans le graphe (`injector/module.js::addModuleRef`, vérifié dans le code de
 * `@nestjs/core`), y compris quand le `DynamicModule` qu'il rend est vide. Un descripteur vide
 * SEUL n'aurait donc pas suffi à empêcher `@InjectQueue` de tenter de résoudre une file absente en
 * mode 'api' — d'où l'extraction de cette logique dans `OrdonnanceurReferentielVehiculesCh`, un
 * provider ORDINAIRE, testée ici en creux : `ReferentielVehiculesChJobModule` lui-même n'a plus NI
 * constructeur NI `OnApplicationBootstrap` (uniquement `static pourConfig`).
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

describe('ReferentielVehiculesChJobModule', () => {
  it("n'implémente plus OnApplicationBootstrap ni de constructeur — logique déménagée dans OrdonnanceurReferentielVehiculesCh", () => {
    // `Function.prototype.length` d'un constructeur TypeScript compilé sans paramètre vaut 0 ;
    // la classe ne doit plus implémenter `onApplicationBootstrap` du tout.
    expect(
      Object.prototype.hasOwnProperty.call(
        ReferentielVehiculesChJobModule.prototype,
        'onApplicationBootstrap',
      ),
    ).toBe(false);
  });

  describe('.pourConfig', () => {
    it("mode 'api' : descripteur vide", () => {
      const descripteur = ReferentielVehiculesChJobModule.pourConfig(config('api'));

      expect(descripteur.imports ?? []).toHaveLength(0);
      expect(descripteur.providers ?? []).toHaveLength(0);
    });

    it("mode 'worker' : le processeur, l'ordonnanceur et le service d'orchestration sont déclarés", () => {
      const descripteur = ReferentielVehiculesChJobModule.pourConfig(config('worker'));
      const providers = descripteur.providers ?? [];

      expect(providers).toContain(ProcesseurReferentielVehiculesCh);
      expect(providers).toContain(OrdonnanceurReferentielVehiculesCh);
      expect(providers).toContain(ServiceJobReferentielVehiculesCh);
    });

    it("mode 'combine' : même contenu qu'en mode worker", () => {
      const descripteur = ReferentielVehiculesChJobModule.pourConfig(config('combine'));

      expect(descripteur.providers ?? []).toContain(ProcesseurReferentielVehiculesCh);
    });
  });
});
