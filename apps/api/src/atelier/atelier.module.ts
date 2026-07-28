import { Module } from '@nestjs/common';

import { JETON_CALCUL_LIGNE, JETON_LECTURE_POINTAGE, LecturePointageVide } from './atelier.jetons';
import { CalculLigneSimple } from './calcul-ligne';
import { DevisComplementaireController } from './devis-complementaire.controller';
import { LigneOrController } from './ligne-or.controller';
import { OrdreReparationController } from './ordre-reparation.controller';
import { OrdreReparationTransitionsController } from './ordre-reparation-transitions.controller';
import { ServiceDevis } from './service-devis';
import { ServiceLigneOr } from './service-ligne-or';
import { ServiceOr } from './service-or';
import { ServiceSnapshotOr } from './service-snapshot-or';
import { ServiceTransitions } from './service-transitions';

/**
 * Façade HTTP complète de l'OR (§7.6-§7.9) : ressource, transitions, lignes (dont les 4 actions
 * groupées) et devis complémentaires — quatre contrôleurs, un par sous-domaine, tous sous le
 * préfixe `ordres-reparation` (même organisation que `vehicules/`, découpage par périmètre plutôt
 * qu'un fichier unique de plusieurs centaines de lignes).
 *
 * `JETON_LECTURE_POINTAGE` : fourni ICI avec l'implémentation vide `LecturePointageVide`
 * (jamais de pointage ouvert, jamais de temps pointé) — exactement la doctrine posée par
 * `atelier.jetons.ts` : « port déclaré par `atelier`, implémenté vide par `AtelierModule`
 * lui-même au lot 1 ». Au lot 2, `PointageModule` fournira la vraie implémentation et ce
 * provider sera retiré d'ici.
 *
 * `JETON_CALCUL_LIGNE` : `ServiceLigneOr` le consomme désormais (création/modification de ligne,
 * colonnes `montant_{ht,tva,ttc}_centimes` NOT NULL en base) — MÊME DOCTRINE que
 * `JETON_LECTURE_POINTAGE` : fourni ICI avec l'implémentation intérimaire `CalculLigneSimple`
 * (voir `calcul-ligne.ts`) tant que `MontantsModule` (L1-14, `atelier/montants/**`) n'existe pas
 * dans ce dépôt. À retirer le jour où ce module est livré.
 *
 * `JETON_COMPTEURS` (numérotation d'OR) n'est pas fourni ici : `CompteursModule`
 * (`@Global`, importé depuis `ParametrageModule`) le rend disponible partout sans import
 * explicite — voir `parametrage/compteurs/compteurs.module.ts`.
 */
@Module({
  controllers: [OrdreReparationController, OrdreReparationTransitionsController, LigneOrController, DevisComplementaireController],
  providers: [
    ServiceOr,
    ServiceSnapshotOr,
    ServiceTransitions,
    ServiceLigneOr,
    ServiceDevis,
    { provide: JETON_LECTURE_POINTAGE, useClass: LecturePointageVide },
    { provide: JETON_CALCUL_LIGNE, useClass: CalculLigneSimple },
  ],
  exports: [ServiceOr, ServiceSnapshotOr, ServiceTransitions, ServiceLigneOr, ServiceDevis],
})
export class AtelierModule {}
