/**
 * Module racine. `AppModule` est lui-même un module dynamique (`pourConfig`) car
 * `ConfigModule.pourRacine` a besoin de la `Config` déjà validée par `chargerConfig` — appelée
 * dans `main.ts` (et dans `openapi/exporter-openapi.ts`), jamais ici : ce fichier ne lit pas
 * `process.env`.
 *
 * `AuthModule` s'auto-suffit (il fournit lui-même son `APP_GUARD` `GardeSession` et importe
 * lui-même `DbAmorcageModule`) : on se contente de l'importer, sans rien reconfigurer ici.
 */
import type { DynamicModule, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CommonModule, MiddlewareContexteRequete } from './common';
import type { Config } from './config';
import { ConfigModule } from './config';
import { DbModule } from './db/db.module';
import { SanteModule } from './sante';
import { SocleModule } from './socle';

@Module({})
export class AppModule implements NestModule {
  static pourConfig(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.pourRacine(config), CommonModule, DbModule, AuthModule, SocleModule, SanteModule],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Enregistré en PREMIER sur `*` : les middlewares Nest tournent avant les guards, donc le
    // ContexteRequete existe déjà quand GardeSession (AuthModule, APP_GUARD) s'exécute et peut
    // y attacher le principal authentifié.
    consumer.apply(MiddlewareContexteRequete).forRoutes('*');
  }
}
