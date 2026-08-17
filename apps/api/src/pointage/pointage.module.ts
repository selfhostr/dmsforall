import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { JETON_SERVICE_MOT_DE_PASSE } from '../auth/jetons';
import { ServiceMotDePasseArgon2id } from '../auth/services/mot-de-passe.service';

import { NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE } from './cloture-automatique-pointage.jetons';
import { OrdonnanceurClotureAutomatiquePointage } from './ordonnanceur-cloture-automatique-pointage';
import { PinController } from './pin.controller';
import { PointagePeriodeController } from './pointage-periode.controller';
import { PointageController } from './pointage.controller';
import { ProcesseurClotureAutomatiquePointage } from './processeur-cloture-automatique-pointage';
import { ServiceClotureAutomatiquePointage } from './service-cloture-automatique-pointage';
import { ServiceIdentificationPin } from './service-identification-pin';
import { ServiceJobClotureAutomatiquePointage } from './service-job-cloture-automatique-pointage';
import { ServiceLecturePointage } from './service-lecture-pointage';
import { ServicePointage } from './service-pointage';
import { ServiceVerrouillagePeriode } from './service-verrouillage-periode';
import { ServiceVerrouillagePin } from './service-verrouillage-pin';

/**
 * Module Pointage (lot 2, RM-87 → RM-99, RM-113 → RM-123). Deux contrôleurs (ressource/actions,
 * verrouillage de période — périmètres distincts, voir leurs en-têtes), trois services.
 *
 * `ServiceLecturePointage` EXPORTÉ pour implémenter le port `LecturePointage` déclaré par `atelier`
 * (`atelier/atelier.jetons.ts`, `JETON_LECTURE_POINTAGE`) — MÊME PATRON que
 * `JETON_CREATION_TRAVAIL_REPORTE` (`ServiceVehiculeTravailReporte`, exporté par `VehiculesModule`,
 * câblé par `AtelierModule` via `useExisting`). CE MODULE NE POSE PAS LE PROVIDER LUI-MÊME :
 * `atelier.module.ts` n'est pas dans le périmètre d'écriture de cet agent (voir la consigne de la
 * tâche). CÂBLAGE DÉJÀ POSÉ (vérifié au 2026-08-03, CORRECTIF d'une note antérieure qui le décrivait
 * comme restant à faire) — `apps/api/src/atelier/atelier.module.ts` importe bien `PointageModule` et
 * fournit `{ provide: JETON_LECTURE_POINTAGE, useExisting: ServiceLecturePointage }` ; `LecturePointageVide`
 * n'y est plus utilisé comme provider actif.
 *
 * Aucun import d'`AtelierModule` ici, dans AUCUN sens : ce module lit `ordre_reparation`/`ligne_or`
 * directement via le schéma Drizzle partagé (`references.ts`, `pointage-requetes.ts`), jamais via
 * les services internes d'`atelier/` — pas de dépendance de compilation entre modules d'experts
 * parallèles (même doctrine que `atelier/or-requetes.ts` vis-à-vis de `vehicules`/`clients`).
 */
/**
 * MODE BORNE PIN — provider de hachage local. `ServiceIdentificationPin` réutilise le MÊME primitif
 * Argon2id que les mots de passe (RM-126), via l'interface `ServiceMotDePasse`
 * (`JETON_SERVICE_MOT_DE_PASSE`). Ce jeton n'est PAS exporté par `AuthModule` (qui n'exporte que
 * `JETON_SERVICE_SESSION`), et `pointage/` ne dépend d'aucun module de fonctionnalité par doctrine.
 * On lie donc localement la classe concrète `ServiceMotDePasseArgon2id` (seule dépendance :
 * `JETON_CONFIG`, global) au jeton d'interface — même patron que `AuthModule`. La coupure de
 * couplage se limite à cette unique ligne du composeur de module ; les services n'injectent que
 * l'interface. Le client Redis de l'anti-balayage (`ServiceVerrouillagePin`) vient de `JETON_REDIS`,
 * fourni globalement par `LimitationModule` — rien à importer ici.
 */
@Module({
  imports: [
    // Socle BullMQ (`OrdonnancementModule`, monté une seule fois à la racine de l'app) —
    // `registerQueue` se raccroche automatiquement à la connexion Redis posée par
    // `BullModule.forRootAsync`, aucun import explicite d'`OrdonnancementModule` requis (même
    // constat que `vehicules/referentiel/referentiel-vehicules-ch-job.module.ts`, le modèle suivi
    // ici — voir `ordonnanceur-cloture-automatique-pointage.ts` pour le détail complet).
    BullModule.registerQueue({ name: NOM_FILE_CLOTURE_AUTOMATIQUE_POINTAGE }),
  ],
  controllers: [PointageController, PointagePeriodeController, PinController],
  providers: [
    ServicePointage,
    ServiceVerrouillagePeriode,
    ServiceLecturePointage,
    ServiceIdentificationPin,
    ServiceVerrouillagePin,
    // RM-91/RM-119 : clôture automatique de fin de journée — DÉSORMAIS DÉCLENCHÉE (chantier
    // "socle d'ordonnancement", 17.08.2026). `ServiceClotureAutomatiquePointage` reste le service
    // métier pur (une transaction par tenant, RLS) ; les trois providers suivants le branchent à
    // BullMQ : `ServiceJobClotureAutomatiquePointage` (orchestration multi-tenant),
    // `ProcesseurClotureAutomatiquePointage` (`@Processor`, consomme la file),
    // `OrdonnanceurClotureAutomatiquePointage` (`OnApplicationBootstrap`, programme le
    // déclenchement quotidien via `Queue.upsertJobScheduler` — voir son en-tête pour pourquoi
    // c'est un PROVIDER de CE module plutôt qu'un second `@Module` séparé enregistré dans
    // `app.module.ts`, hors périmètre d'écriture de cet agent).
    ServiceClotureAutomatiquePointage,
    ServiceJobClotureAutomatiquePointage,
    ProcesseurClotureAutomatiquePointage,
    OrdonnanceurClotureAutomatiquePointage,
    { provide: JETON_SERVICE_MOT_DE_PASSE, useClass: ServiceMotDePasseArgon2id },
  ],
  exports: [
    ServicePointage,
    ServiceVerrouillagePeriode,
    ServiceLecturePointage,
    ServiceClotureAutomatiquePointage,
  ],
})
export class PointageModule {}
