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
import { CourtoisieModule } from './atelier/courtoisie/courtoisie.module';
import { ImpressionOrModule } from './atelier/impression/impression-or.module';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { CommonModule, MiddlewareContexteRequete } from './common';
import type { Config } from './config';
import { ConfigModule } from './config';
import { ConnecteursModule } from './connecteurs/connecteurs.module';
import { CourrielModule } from './courriel';
import { DbModule } from './db/db.module';
import { ExploitationModule } from './exploitation';
import { CycleVieTenantJobModule } from './exploitation/cycle-vie-tenant/cycle-vie-tenant-job.module';
import { CycleVieTenantModule } from './exploitation/cycle-vie-tenant/cycle-vie-tenant.module';
import { FacturationModule } from './facturation/facturation.module';
import { ImpressionModule } from './facturation/impression/impression.module';
import { OrdonnancementModule } from './ordonnancement';
import { ParametrageModule } from './parametrage/parametrage.module';
import { PiecesModule } from './pieces/pieces.module';
import { PneusModule } from './pneus/pneus.module';
import { PointageClotureAutomatiqueJobModule } from './pointage/pointage-cloture-automatique-job.module';
import { PointageModule } from './pointage/pointage.module';
import { RechercheModule } from './recherche/recherche.module';
import { RelancesJobModule } from './relances/relances-job.module';
import { RelancesModule } from './relances/relances.module';
import { RepriseJobModule } from './reprise/reprise-job.module';
import { RepriseModule } from './reprise/reprise.module';
import { RendezVousModule } from './rendezvous/rendezvous.module';
import { SanteModule } from './sante';
import { SocleModule } from './socle';
import { TableauBordModule } from './tableau-bord/tableau-bord.module';
import { TempsReelModule } from './temps-reel';
import { ReferentielVehiculesChJobModule } from './vehicules/referentiel/referentiel-vehicules-ch-job.module';
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
        // Socle d'ordonnancement (BullMQ) — PREMIER ordonnanceur de ce dépôt, voir
        // `ordonnancement/ordonnancement.module.ts` pour le choix d'architecture complet. Monté
        // une seule fois ici ; tout module de job (ex. `ReferentielVehiculesChJobModule`, le job
        // quotidien de contrôle/import du référentiel véhicules ASTRA, plus bas) importe
        // `BullModule.registerQueue(...)` directement, sans réimporter celui-ci.
        //
        // Les quatre bundles de job du dépôt (ASTRA, clôture pointage, reprise, cycle de vie
        // tenant) sont chacun des modules `*JobModule` DYNAMIQUES (`.pourConfig(config)`), gatés
        // par `config.MODE_PROCESSUS` (chantier « découplage worker/API », 27.08.2026) — voir
        // `ordonnancement/mode-processus.ts` : vides en mode 'api' (aucun `@Processor` enregistré,
        // pas seulement inactif), pleins en mode 'worker'/'combine'. Chacun est enregistré ICI, à
        // côté de son module de domaine, jamais imbriqué DANS ce module de domaine — voir l'en-tête
        // de chacun (ex. `pointage/pointage-cloture-automatique-job.module.ts`) pour pourquoi
        // (risque de double-instanciation d'un module importé ailleurs sous forme statique).
        OrdonnancementModule,
        // `CourrielModule` (capacité d'envoi de courriel — SMTP Infomaniak/capture, voir
        // `courriel/`) — SOCLE SEUL, aucun branchement métier pour l'instant (ni relances, ni
        // envoi de facture, ni invitation d'utilisateur : ces usages viendront plus tard, par
        // d'autres modules qui injecteront `ServiceCourriel`). Aucune dépendance de compilation
        // avec un autre module métier, placé ici par simple cohérence avec les autres briques
        // d'infrastructure transverse (Common/Db/Auth/Socle/Sante) juste au-dessus.
        CourrielModule,
        // Lot 1 (L1-16) — `ParametrageModule` en premier : il porte `CompteursModule` (`@Global`),
        // dont `ClientsModule`/`AtelierModule` dépendent (`JETON_COMPTEURS`) sans l'importer
        // explicitement (anti-cycle, voir `atelier/atelier.jetons.ts`). L'ordre des `imports` Nest
        // n'a normalement pas d'incidence sur la résolution (un seul graphe est construit avant
        // toute instanciation), mais le poser en tête documente cette dépendance implicite.
        ParametrageModule,
        ClientsModule,
        VehiculesModule,
        // Job quotidien de contrôle/import du référentiel véhicules ASTRA — DÉPLACÉ hors de
        // `VehiculesModule` le 27.08.2026 (chantier « découplage worker/API ») : module dynamique
        // gaté par `MODE_PROCESSUS` (voir `referentiel-vehicules-ch-job.module.ts`), vide en mode
        // 'api'. Enregistré ici, à côté de `VehiculesModule`, plutôt qu'imbriqué dedans — seul CE
        // fichier connaît `config` au moment de construire le graphe.
        ReferentielVehiculesChJobModule.pourConfig(config),
        RechercheModule,
        AtelierModule,
        // `ImpressionOrModule` (GET /ordres-reparation/{orId}/pdf — feuille d'atelier, chantier
        // « impression OR ») importe `AtelierModule` lui-même (pour `ServiceOr`, exporté) plutôt
        // que l'inverse — même raison et même câblage en fin de section que `ImpressionModule`
        // (facturation) plus bas : sans cette ligne, le module compile et ses tests passent, mais
        // AUCUNE route `/ordres-reparation/{orId}/pdf` n'existe.
        ImpressionOrModule,
        PiecesModule,
        // `PointageModule` livré, non enregistré jusqu'ici (lot 2) — enregistré par le mainteneur
        // au nom du lot `pointage/`, qui n'a pas accès à ce fichier. Après `AtelierModule` :
        // `PointageModule` ne dépend pas d'`AtelierModule` (voir sa tête de fichier, aucune
        // dépendance de compilation entre modules d'experts parallèles), mais le câblage du port
        // `JETON_LECTURE_POINTAGE` (`atelier.module.ts`, `useExisting: ServiceLecturePointage`)
        // reste à poser par un correctif distinct — voir la consigne transmise avec ce module.
        PointageModule,
        // Branchement BullMQ de la clôture automatique de fin de journée du pointage — DÉPLACÉ
        // hors de `PointageModule` le 27.08.2026 (chantier « découplage worker/API », voir
        // `pointage-cloture-automatique-job.module.ts`) : module dynamique gaté par
        // `MODE_PROCESSUS`, vide en mode 'api'.
        PointageClotureAutomatiqueJobModule.pourConfig(config),
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
        // `RelancesModule` (lot 1 — facturation, rappel #2, `docs/specification-relances-
        // automatiques.md`) — importe `ConnecteursModule` lui-même (`RegistreConnecteursService`,
        // résolution de l'adaptateur `NotificationSender`) ; placé après lui par lisibilité,
        // aucune contrainte d'ordre réelle (même raisonnement que `PneusModule` juste au-dessus).
        RelancesModule,
        // Branchement BullMQ des relances de facturation (rappel #2) — comble le trou documenté
        // par `service-relances-facture.ts` (§ en-tête : « Aucun ordonnanceur n'existe dans ce
        // dépôt »), ajouté le 27.08.2026 : module dynamique gaté par `MODE_PROCESSUS`, vide en
        // mode 'api', même patron que `PointageClotureAutomatiqueJobModule` etc. plus haut — voir
        // `relances/relances-job.module.ts`.
        RelancesJobModule.pourConfig(config),
        // `RendezVousModule` (lot RDV-1 — prise de rendez-vous d'atelier,
        // `docs/conception-rendez-vous-metier.md`/`docs/conception-rendez-vous-donnees.md`) —
        // importe `AtelierModule` lui-même (`ServiceOr`/`ServiceTransitions`, réception du
        // véhicule via T-03 `planifie -> ouvert` déjà câblée) ; placé après lui par lisibilité,
        // même raisonnement que `PneusModule`/`RelancesModule` ci-dessus (aucune contrainte
        // d'ordre réelle, `AtelierModule` n'importe jamais ce module — sens unique).
        RendezVousModule,
        CourtoisieModule,
        // `RepriseModule` (reprise de données par dépôt d'archive, `contrats/reprise.ts`,
        // migrations 0066/0067) — aucune dépendance de compilation avec un autre module métier
        // (lit/écrit `client`/`vehicule`/`document_vente` en SQL brut, comme `TableauBordModule`
        // plus haut). ÉTAIT NON ENREGISTRÉ ici jusqu'à ce lot — piège vérifié n°1 du projet
        // (contrôleur non déclaré = 404 silencieux), refermé : voir la tête de `reprise.module.ts`.
        RepriseModule,
        // Branchement CONSOMMATEUR des deux files de reprise (`ProcesseurAnalyseReprise`/
        // `ProcesseurImportReprise`) — DÉPLACÉ hors de `RepriseModule` le 27.08.2026 (chantier
        // « découplage worker/API », voir `reprise-job.module.ts`) : module dynamique gaté par
        // `MODE_PROCESSUS`, vide en mode 'api'. `RepriseModule` ci-dessus continue de poser les
        // DEUX files (producteurs HTTP, inconditionnel) — seuls les deux `@Processor` ont bougé.
        RepriseJobModule.pourConfig(config),
        // `TempsReelModule` (canal SSE générique de notification poste fixe, socle) — importe
        // `AuthModule` lui-même (`JETON_SERVICE_SESSION`, revalidation de session sur une
        // connexion longue) ; aucun module métier ne l'importe encore, il est enregistré ici pour
        // que `ServiceEvenementsTempsReel` soit injectable par le premier consommateur (scan de
        // permis de circulation, `vehicules/`) — même patron que `ConnecteursModule` plus haut :
        // aucune dépendance de compilation avec un autre module métier à ce stade.
        TempsReelModule,
        // `ExploitationModule` (console d'exploitation, PORTE 1 — agrégats de plateforme, aucune
        // donnée personnelle, `docs/conception-console-exploitation-acces.md`) — ÉTEINTE PAR
        // DÉFAUT : `ExploitationModule.pourConfig` rend un module vide (aucun contrôleur, aucun
        // pool `dfa_console`) tant que `DATABASE_URL_CONSOLE` n'est pas renseignée. Placé en
        // toute fin, comme `ConnecteursModule`/`RelancesModule` juste au-dessus : aucune
        // dépendance de compilation avec un autre module métier, et volontairement PAS `@Global`
        // — voir la tête de fichier d'`exploitation.module.ts` pour pourquoi aucun module métier
        // ne doit pouvoir injecter le plan console.
        ExploitationModule.pourConfig(config),
        // `CycleVieTenantModule` (offboarding — export intégral, conservation limitée, effacement
        // automatique, migration 0062) — droit MÉTIER ORDINAIRE déclenché par
        // le garage lui-même (`GardeDroit`, jamais `GardeExploitant`), aucun rapport avec
        // `ExploitationModule` juste au-dessus malgré le nom du répertoire qui l'héberge
        // (`exploitation/cycle-vie-tenant/`) : PAS de dépendance de compilation entre les deux,
        // PAS soumis à l'extinction par défaut d'`ExploitationModule.pourConfig`. Placé en toute
        // fin, comme `ConnecteursModule`/`RelancesModule`/`TempsReelModule` plus haut : aucune
        // contrainte d'ordre réelle.
        CycleVieTenantModule,
        // Branchement PLANIFIÉ/CONSOMMATEUR du cycle de vie de sortie du garage (purge
        // automatique, `@Processor` de l'export) — DÉPLACÉ hors de `CycleVieTenantModule` le
        // 27.08.2026 (chantier « découplage worker/API », voir `cycle-vie-tenant-job.module.ts`) :
        // module dynamique gaté par `MODE_PROCESSUS`, vide en mode 'api'. `CycleVieTenantModule`
        // ci-dessus continue de poser la file d'export (producteur HTTP, inconditionnel) — seuls
        // la file de purge et les processeurs/ordonnanceurs ont bougé.
        CycleVieTenantJobModule.pourConfig(config),
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
