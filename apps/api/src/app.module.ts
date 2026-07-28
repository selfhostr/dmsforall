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
import { AtelierModule } from './atelier/atelier.module';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { CommonModule, MiddlewareContexteRequete } from './common';
import type { Config } from './config';
import { ConfigModule } from './config';
import { DbModule } from './db/db.module';
import { ParametrageModule } from './parametrage/parametrage.module';
import { RechercheModule } from './recherche/recherche.module';
import { SanteModule } from './sante';
import { SocleModule } from './socle';
import { VehiculesModule } from './vehicules/vehicules.module';

@Module({})
export class AppModule implements NestModule {
  static pourConfig(config: Config): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.pourRacine(config),
        CommonModule,
        DbModule,
        AuthModule,
        SocleModule,
        SanteModule,
        // Lot 1 (L1-16) — `ParametrageModule` en premier : il porte `CompteursModule` (`@Global`),
        // dont `ClientsModule`/`AtelierModule` dépendent (`JETON_COMPTEURS`) sans l'importer
        // explicitement (anti-cycle, voir `atelier/atelier.jetons.ts`). L'ordre des `imports` Nest
        // n'a normalement pas d'incidence sur la résolution (un seul graphe est construit avant
        // toute instanciation), mais le poser en tête documente cette dépendance implicite.
        ParametrageModule,
        ClientsModule,
        VehiculesModule,
        RechercheModule,
        AtelierModule,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // Enregistré en PREMIER sur `*` : les middlewares Nest tournent avant les guards, donc le
    // ContexteRequete existe déjà quand GardeSession (AuthModule, APP_GUARD) s'exécute et peut
    // y attacher le principal authentifié.
    consumer.apply(MiddlewareContexteRequete).forRoutes('*');
  }
}
