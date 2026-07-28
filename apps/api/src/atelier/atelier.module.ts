import { Module } from '@nestjs/common';

import { JETON_LECTURE_POINTAGE, LecturePointageVide } from './atelier.jetons';
import { ServiceOr } from './service-or';
import { ServiceSnapshotOr } from './service-snapshot-or';
import { ServiceTransitions } from './service-transitions';

/**
 * AUCUN contrôleur, comme `clients/` : `apps/api/src/atelier/**` est, à ce jour, la couche
 * domaine de l'OR (machine à états, snapshot figé, totaux par payeur) sans façade HTTP —
 * signalé dans la réponse de tâche.
 *
 * `JETON_LECTURE_POINTAGE` : fourni ICI avec l'implémentation vide `LecturePointageVide`
 * (jamais de pointage ouvert, jamais de temps pointé) — exactement la doctrine posée par
 * `atelier.jetons.ts` : « port déclaré par `atelier`, implémenté vide par `AtelierModule`
 * lui-même au lot 1 ». Au lot 2, `PointageModule` fournira la vraie implémentation et ce
 * provider sera retiré d'ici.
 *
 * `JETON_CALCUL_LIGNE` (`MontantsModule`, L1-14) N'EST PAS fourni ici : `ServiceOr` ne l'injecte
 * pas encore (aucun `@Inject(JETON_CALCUL_LIGNE)` dans son constructeur) — rien à câbler tant
 * que ce port n'est pas réellement consommé.
 *
 * `JETON_COMPTEURS` (numérotation d'OR) n'est pas non plus fourni ici : `CompteursModule`
 * (`@Global`, importé depuis `ParametrageModule`) le rend disponible partout sans import
 * explicite — voir `parametrage/compteurs/compteurs.module.ts`.
 */
@Module({
  providers: [
    ServiceOr,
    ServiceSnapshotOr,
    ServiceTransitions,
    { provide: JETON_LECTURE_POINTAGE, useClass: LecturePointageVide },
  ],
  exports: [ServiceOr, ServiceSnapshotOr, ServiceTransitions],
})
export class AtelierModule {}
