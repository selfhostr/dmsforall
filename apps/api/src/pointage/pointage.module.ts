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
 * tâche). Câblage à poser par le coordinateur dans `apps/api/src/atelier/atelier.module.ts` :
 *
 *   1. `imports: [..., PointageModule]`
 *   2. remplacer `{ provide: JETON_LECTURE_POINTAGE, useClass: LecturePointageVide }`
 *      par `{ provide: JETON_LECTURE_POINTAGE, useExisting: ServiceLecturePointage }`
 *   3. retirer l'import de `LecturePointageVide` s'il devient inutilisé.
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
