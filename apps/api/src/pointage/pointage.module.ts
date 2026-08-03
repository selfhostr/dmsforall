import { Module } from '@nestjs/common';

import { PointagePeriodeController } from './pointage-periode.controller';
import { PointageController } from './pointage.controller';
import { ServiceLecturePointage } from './service-lecture-pointage';
import { ServicePointage } from './service-pointage';
import { ServiceVerrouillagePeriode } from './service-verrouillage-periode';

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
@Module({
  controllers: [PointageController, PointagePeriodeController],
  providers: [ServicePointage, ServiceVerrouillagePeriode, ServiceLecturePointage],
  exports: [ServicePointage, ServiceVerrouillagePeriode, ServiceLecturePointage],
})
export class PointageModule {}
