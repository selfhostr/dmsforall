import { DynamicModule, Global, Module } from '@nestjs/common';
import { Config, JETON_CONFIG } from './charger-config';

/**
 * Expose la config déjà validée (par `chargerConfig` dans `main.ts`) au reste de l'app via
 * `JETON_CONFIG`. Global : chaque module qui a besoin d'une valeur de config l'injecte
 * directement, sans réimporter ce module partout.
 */
@Global()
@Module({})
export class ConfigModule {
  static pourRacine(config: Config): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: JETON_CONFIG, useValue: config }],
      exports: [JETON_CONFIG],
    };
  }
}
