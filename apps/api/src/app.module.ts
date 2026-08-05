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
import { ConnecteursModule } from './connecteurs/connecteurs.module';
import { DbModule } from './db/db.module';
import { FacturationModule } from './facturation/facturation.module';
import { ImpressionModule } from './facturation/impression/impression.module';
import { ParametrageModule } from './parametrage/parametrage.module';
import { PiecesModule } from './pieces/pieces.module';
import { PneusModule } from './pneus/pneus.module';
import { PointageModule } from './pointage/pointage.module';
import { RechercheModule } from './recherche/recherche.module';
import { SanteModule } from './sante';
import { SocleModule } from './socle';
import { TableauBordModule } from './tableau-bord/tableau-bord.module';
import { VehiculesModule } from './vehicules/vehicules.module';
import { VentesModule } from './ventes/ventes.module';

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
        PiecesModule,
        // `PointageModule` livré, non enregistré jusqu'ici (lot 2) — enregistré par l'orchestrateur
        // au nom de l'agent `pointage/`, qui n'a pas accès à ce fichier. Après `AtelierModule` :
        // `PointageModule` ne dépend pas d'`AtelierModule` (voir sa tête de fichier, aucune
        // dépendance de compilation entre modules d'experts parallèles), mais le câblage du port
        // `JETON_LECTURE_POINTAGE` (`atelier.module.ts`, `useExisting: ServiceLecturePointage`)
        // reste à poser par un correctif distinct — voir la consigne transmise avec ce module.
        PointageModule,
        VentesModule,
        FacturationModule,
        // `ImpressionModule` (GET /documents-vente/{id}/pdf) importe `FacturationModule` lui-même
        // (pour `ServiceDocumentsVente`, exporté) plutôt que l'inverse — `FacturationModule` important
        // `ImpressionModule` créerait un cycle de modules (même raison que `PaiementsModule`/
        // `ExportModule` sont importés PAR `FacturationModule`, jamais l'inverse). D'où le câblage
        // ici, en toute fin, plutôt que dans `facturation.module.ts` : sans cette ligne, le module
        // compile et ses tests passent, mais AUCUNE route `/documents-vente/{id}/pdf` n'existe — le
        // piège du dépôt vérifié explicitement pour ce lot (module complet, jamais enregistré).
        ImpressionModule,
        // `TableauBordModule` (`GET /tableau-bord/activite`, `GET /tableau-bord/financier`) lit en
        // SQL brut les tables `ordre_reparation`/`ligne_or`/`stock_article`/`article` (atelier,
        // pieces) et `document_vente`/`paiement` (facturation) — placé après ces quatre modules par
        // lisibilité (aucune dépendance de compilation réelle : `apps/api/src/tableau-bord/**`
        // n'importe aucun service d'un autre module, voir sa tête de fichier).
        TableauBordModule,
        // `PneusModule` (hangar à pneus, `docs/specification-parc-et-hangar-pneus.md`, Lot A) —
        // aucune dépendance de compilation avec un autre module (lit `vehicule`/`site`/`ligne_or`
        // en lecture SQL directe, comme `TableauBordModule` juste au-dessus) : placé en toute fin
        // par simple ordre d'ajout, pas de contrainte d'ordre réelle.
        PneusModule,
        // `ConnecteursModule` (étape 5 — socle d'exécution : registre, exécuteur résilient, cinq
        // adaptateurs factices) — aucun contrôleur HTTP, aucune dépendance de compilation avec un
        // autre module métier ; enregistré ici pour que `RegistreConnecteursService`/
        // `ServiceExecuteurConnecteurResilient` soient injectables par un futur module qui en
        // aurait besoin, voir `connecteurs/connecteurs.module.ts`.
        ConnecteursModule,
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
