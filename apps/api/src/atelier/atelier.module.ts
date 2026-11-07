import { Module } from '@nestjs/common';

import { PointageModule } from '../pointage/pointage.module';
import { ServiceLecturePointage } from '../pointage/service-lecture-pointage';
import { ClientsModule } from '../clients/clients.module';
import { FacturationModule } from '../facturation/facturation.module';
import { PiecesModule } from '../pieces/pieces.module';
import { ServiceVehiculeTravailReporte } from '../vehicules/service-vehicule-travail-reporte';
import { VehiculesModule } from '../vehicules/vehicules.module';

import {
  JETON_CALCUL_LIGNE,
  JETON_CREATION_TRAVAIL_REPORTE,
  JETON_LECTURE_POINTAGE,
} from './atelier.jetons';
import { CalculLigneSimple } from './calcul-ligne';
import { DevisVersOrController } from './devis-vers-or.controller';
import { DevisComplementaireController } from './devis-complementaire.controller';
import { ImpressionDevisController } from './impression/impression-devis.controller';
import { ServiceImpressionDevis } from './impression/service-impression-devis';
import { LigneOrController } from './ligne-or.controller';
import { PhotosLigneModule } from './photos/photos-ligne.module';
import { OrdreReparationController } from './ordre-reparation.controller';
import { OrdreReparationTransitionsController } from './ordre-reparation-transitions.controller';
import { ServiceDevis } from './service-devis';
import { ServiceDevisVersOr } from './service-devis-vers-or';
import { ServiceCreationRapideOr } from './service-creation-rapide-or';
import { ServiceFacturationEncaissementOr } from './service-facturation-encaissement-or';
import { ServiceFacturationOr } from './service-facturation-or';
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
 *
 * `FacturationModule` importé pour `ServiceFacturationOr` (`RF-81`,
 * `POST /ordres-reparation/{orId}/facturer`) : ce service crée des brouillons de facture, il a
 * donc besoin de `ServiceDocumentsVente` (exporté par `FacturationModule`) pour assembler la
 * représentation `ReponseDocumentVente` de chaque document créé — MÊME REPRÉSENTATION que
 * `GET /documents-vente/{id}`, jamais une projection ad hoc. Sens de dépendance à SENS UNIQUE :
 * `FacturationModule` n'importe jamais `AtelierModule` (vérifié : `grep -rn AtelierModule
 * apps/api/src/facturation/` ne trouve qu'un commentaire) — aucun cycle.
 *
 * `VehiculesModule` importé pour `JETON_CREATION_TRAVAIL_REPORTE` (RM-73) : `refuserLignes`
 * (`ServiceLigneOr`) doit alimenter les travaux reportés du véhicule quand une ligne est refusée
 * — `ServiceVehiculeTravailReporte`, désormais EXPORTÉ par `VehiculesModule` précisément pour cet
 * usage, implémente le port `CreationTravailReporte` déclaré côté `atelier`
 * (`atelier.jetons.ts`). Même sens de dépendance à SENS UNIQUE que `FacturationModule` :
 * `VehiculesModule` n'importe jamais `AtelierModule` (vérifié : seuls des commentaires y
 * référencent ce nom) — aucun cycle.
 *
 * `PiecesModule` importé pour `ServiceReservation`/`ServiceConsigne` (RP-21/RP-23/RP-38) :
 * `ServiceLigneOr.marquerRealisee`/`refuserLignes`/`annulerLignes` composent avec leurs variantes
 * `*Tx` (dette technique soldée — voir la doc de `ServiceLigneOr.satisfaireReservationSiApplicable`)
 * pour que la réservation/consigne commite DANS LA MÊME transaction que le changement d'état de la
 * ligne. Même sens de dépendance à SENS UNIQUE que `FacturationModule`/`VehiculesModule` :
 * `PiecesModule` n'importe jamais `AtelierModule` (vérifié : aucune référence, même en
 * commentaire) — aucun cycle. Même précédent que `PneusModule`/`VentesModule`, qui importent déjà
 * `PiecesModule`.
 *
 * `ImpressionDevisController`/`ServiceImpressionDevis` (`impression/`, PDF du devis complémentaire)
 * déclarés ICI plutôt que dans un module séparé du type `impression/impression-or.module.ts` :
 * ce dernier n'existe qu'en sibling d'`AtelierModule` dans `apps/api/src/app.module.ts`, HORS du
 * périmètre d'écriture de la tâche qui a introduit l'impression du devis. Les câbler directement
 * dans `AtelierModule` (déjà importé par `app.module.ts`) évite d'y toucher tout en produisant la
 * même route servie — signalé au coordinateur : un `ImpressionDevisModule` séparé, symétrique à
 * `ImpressionOrModule`, resterait un refactor cosmétique sans risque si la symétrie est préférée.
 */
@Module({
  imports: [
    FacturationModule,
    VehiculesModule,
    PointageModule,
    PiecesModule,
    PhotosLigneModule,
    ClientsModule,
  ],
  controllers: [
    OrdreReparationController,
    OrdreReparationTransitionsController,
    LigneOrController,
    DevisComplementaireController,
    DevisVersOrController,
    ImpressionDevisController,
  ],
  providers: [
    ServiceOr,
    ServiceSnapshotOr,
    ServiceTransitions,
    ServiceLigneOr,
    ServiceDevis,
    ServiceDevisVersOr,
    ServiceFacturationOr,
    ServiceFacturationEncaissementOr,
    ServiceCreationRapideOr,
    ServiceImpressionDevis,
    { provide: JETON_LECTURE_POINTAGE, useExisting: ServiceLecturePointage },
    { provide: JETON_CALCUL_LIGNE, useClass: CalculLigneSimple },
    { provide: JETON_CREATION_TRAVAIL_REPORTE, useExisting: ServiceVehiculeTravailReporte },
  ],
  exports: [
    ServiceOr,
    ServiceSnapshotOr,
    ServiceTransitions,
    ServiceLigneOr,
    ServiceDevis,
    ServiceFacturationOr,
  ],
})
export class AtelierModule {}
