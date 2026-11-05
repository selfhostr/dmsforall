import { Module } from '@nestjs/common';

import { JETON_SERVICE_MOT_DE_PASSE } from '../auth/jetons';
import { ServiceMotDePasseArgon2id } from '../auth/services/mot-de-passe.service';

import { PinController } from './pin.controller';
import { PointagePeriodeController } from './pointage-periode.controller';
import { PointageController } from './pointage.controller';
import { ServiceClotureAutomatiquePointage } from './service-cloture-automatique-pointage';
import { ServiceIdentificationPin } from './service-identification-pin';
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
 * `atelier.module.ts` n'est pas dans le périmètre d'écriture de ce lot (voir la consigne de la
 * tâche). CÂBLAGE DÉJÀ POSÉ (vérifié au 2026-08-03, CORRECTIF d'une note antérieure qui le décrivait
 * comme restant à faire) — `apps/api/src/atelier/atelier.module.ts` importe bien `PointageModule` et
 * fournit `{ provide: JETON_LECTURE_POINTAGE, useExisting: ServiceLecturePointage }` ; `LecturePointageVide`
 * n'y est plus utilisé comme provider actif.
 *
 * Aucun import d'`AtelierModule` ici, dans AUCUN sens : ce module lit `ordre_reparation`/`ligne_or`
 * directement via le schéma Drizzle partagé (`references.ts`, `pointage-requetes.ts`), jamais via
 * les services internes d'`atelier/` — pas de dépendance de compilation entre modules d'experts
 * parallèles (même doctrine que `atelier/or-requetes.ts` vis-à-vis de `vehicules`/`clients`).
 *
 * `ServiceClotureAutomatiquePointage` (métier pur, une transaction par tenant, RLS — AUCUNE
 * connaissance de BullMQ) reste ici et EXPORTÉ. Son branchement BullMQ (file, `@Processor`,
 * ordonnanceur quotidien) a DÉMÉNAGÉ le 27.08.2026 (chantier « découplage worker/API ») dans
 * `pointage-cloture-automatique-job.module.ts`, un second `@Module` DYNAMIQUE (`.pourConfig`),
 * enregistré séparément dans `app.module.ts` — JAMAIS importé ici, pour deux raisons :
 *   1. `PointageModule` lui-même reste importé TEL QUEL (classe statique, sans `.pourConfig`) à
 *      la fois par `app.module.ts` ET par `atelier/atelier.module.ts` (pour `JETON_LECTURE_
 *      POINTAGE`) — Nest déduplique un import statique par RÉFÉRENCE DE CLASSE, mais PAS deux
 *      appels séparés à `.pourConfig(...)` (chacun produit un objet distinct, donc un second
 *      graphe/une seconde instance de tout ce module, y compris ses contrôleurs — vérifié dans le
 *      code de `@nestjs/core`, `ByReferenceModuleOpaqueKeyFactory`). Faire varier CE module par
 *      mode l'aurait donc cassé silencieusement dès qu'`atelier.module.ts` l'importe. Le bundle
 *      BullMQ, lui, n'est importé que d'un seul endroit (`app.module.ts`) : aucun risque.
 *   2. C'est exactement ce que prévoyait déjà le commentaire de tête d'`ordonnanceur-cloture-
 *      automatique-pointage.ts` avant ce chantier (« un second `@Module` séparé devrait être
 *      enregistré explicitement dans `app.module.ts` — hors du périmètre d'écriture exclusif de
 *      ce lot ») : ce chantier a précisément accès à `app.module.ts`, donc le déplacement
 *      annoncé peut enfin avoir lieu.
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
  controllers: [PointageController, PointagePeriodeController, PinController],
  providers: [
    ServicePointage,
    ServiceVerrouillagePeriode,
    ServiceLecturePointage,
    ServiceIdentificationPin,
    ServiceVerrouillagePin,
    ServiceClotureAutomatiquePointage,
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
