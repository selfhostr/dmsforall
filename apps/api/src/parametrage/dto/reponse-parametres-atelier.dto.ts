import { ApiProperty } from '@nestjs/swagger';
import {
  ARRONDIS_POINTAGE,
  CANAUX_RAPPEL,
  MODES_PRODUITS_ATELIER,
  POLITIQUES_CONTROLE_QUALITE,
  POLITIQUES_DEMONTAGE_REFUSE,
  POLITIQUES_DEUX_OR_MEME_VEHICULE,
  POLITIQUES_LANGUE_DOCUMENT,
  POLITIQUES_MENTION_SECURITE,
  POLITIQUES_SIGNATURE_RECEPTION,
  PORTEES_NUMEROTATION,
  UNITES_TEMPS,
  VISIBILITES_HISTORIQUE_VEHICULE,
} from '@dfa/shared';

/**
 * DTO Swagger de `GET /parametres-atelier` (contrats-api-etape-1.md §8.2). Structure calquée sur
 * `DtoParametresAtelier` (`../parametres-atelier/mappeur-parametres-atelier.ts`) — voir ce fichier
 * pour l'écart signalé sur `reception.plafondDefautCentimes` (`number | null`, pas `number` comme
 * le déclare `ReponseParametresAtelier` gelé de `packages/shared`), et pour le second écart de même
 * nature sur `reception.plafondAvoirReceptionnaireCentimes` (RF-117, champ absent du contrat gelé).
 */
export class OrParametresAtelierDto {
  @ApiProperty({ example: 'OR' }) readonly prefixe!: string;
  @ApiProperty({ enum: PORTEES_NUMEROTATION }) readonly porteeNumerotation!: (typeof PORTEES_NUMEROTATION)[number];
  @ApiProperty() readonly resetAnnuel!: boolean;
  @ApiProperty({ description: 'P-22 : l\'état `planifie` est-il utilisé par ce garage ?' }) readonly etatPlanifieActif!: boolean;
  @ApiProperty({ description: 'P-21 : un OR sans RDV est-il autorisé ?' }) readonly sansRdvAutorise!: boolean;
  @ApiProperty() readonly rdvRetroactifAuto!: boolean;
  @ApiProperty({ enum: POLITIQUES_DEUX_OR_MEME_VEHICULE }) readonly deuxOrMemeVehicule!: (typeof POLITIQUES_DEUX_OR_MEME_VEHICULE)[number];
}

export class ReceptionParametresAtelierDto {
  @ApiProperty() readonly kmEntreeObligatoire!: boolean;
  @ApiProperty() readonly kmSortieObligatoire!: boolean;
  @ApiProperty({ enum: POLITIQUES_SIGNATURE_RECEPTION }) readonly signature!: (typeof POLITIQUES_SIGNATURE_RECEPTION)[number];
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Q-02 : `null` = aucun plafond convenu (la garde RM-54 ne s\'exécute jamais) ; `0` = accord ' +
      'requis pour toute validation payante ; n>0 = plafond nominal. ÉCART avec le contrat TS gelé ' +
      '`ReponseParametresAtelier` (`number` non nullable) — signalé, `null` est une valeur métier ' +
      'réelle qu\'un `0` de repli confondrait avec « accord systématique requis ».',
    example: 30000,
  })
  readonly plafondDefautCentimes!: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'RF-117 (0018) : plafond d\'émission d\'AVOIR par un `receptionnaire` seul — au-delà, ' +
      '`direction`/`comptable` prennent le relais. MÊME sémantique que `plafondDefautCentimes` ' +
      'ci-dessus : `null` = aucun plafond convenu (défaut — le réceptionnaire émet sans limite, ' +
      'dégradé documenté préservé) ; `0` = toute émission par un réceptionnaire doit escalader ; ' +
      'n>0 = plafond nominal en centimes. Absent du contrat TS gelé `ReponseParametresAtelier` ' +
      '(`packages/shared`) — signalé, même écart que `plafondDefautCentimes`.',
    example: 500000,
  })
  readonly plafondAvoirReceptionnaireCentimes!: number | null;
}

export class TravauxParametresAtelierDto {
  @ApiProperty({ enum: UNITES_TEMPS }) readonly uniteTemps!: (typeof UNITES_TEMPS)[number];
  @ApiProperty({ enum: ARRONDIS_POINTAGE }) readonly arrondiPointage!: (typeof ARRONDIS_POINTAGE)[number];
  @ApiProperty() readonly chevauchementPointageAutorise!: boolean;
  @ApiProperty() readonly pointageObligatoirePourTerminer!: boolean;
  @ApiProperty({
    enum: POLITIQUES_CONTROLE_QUALITE,
    description: 'Restreint à `jamais`/`toujours` au lot 1 (Δ3) — le type complet à 4 valeurs est réservé au lot 2.',
  })
  readonly controleQualite!: (typeof POLITIQUES_CONTROLE_QUALITE)[number];
  @ApiProperty() readonly dureeMaxPointageHeures!: number;
}

export class ProduitsAtelierDto {
  @ApiProperty({ enum: MODES_PRODUITS_ATELIER }) readonly mode!: (typeof MODES_PRODUITS_ATELIER)[number];
  @ApiProperty({ type: Number, nullable: true }) readonly pourmille!: number | null;
  @ApiProperty({ type: Number, nullable: true }) readonly plafondCentimes!: number | null;
}

export class FacturationParametresAtelierDto {
  @ApiProperty() readonly multiPayeursAutorise!: boolean;
  @ApiProperty() readonly restitutionAvantPaiement!: boolean;
  @ApiProperty({
    description:
      'Aucune colonne dédiée en base au lot 1 (domaine inerte, `fonctionnalites.facturation=false`) ' +
      '— valeur par défaut posée en attendant le schéma de l\'étape 2.',
  })
  readonly piecesClientAutorisees!: boolean;
  @ApiProperty({ enum: POLITIQUES_DEMONTAGE_REFUSE }) readonly politiqueDemontageRefuse!: (typeof POLITIQUES_DEMONTAGE_REFUSE)[number];
  @ApiProperty({ type: Number, nullable: true, description: 'Idem : aucune colonne dédiée en base au lot 1.' })
  readonly seuilDemontageCentimes!: number | null;
  @ApiProperty({ type: () => ProduitsAtelierDto }) readonly produitsAtelier!: ProduitsAtelierDto;
}

export class DocumentsParametresAtelierDto {
  @ApiProperty({ enum: POLITIQUES_LANGUE_DOCUMENT }) readonly langue!: (typeof POLITIQUES_LANGUE_DOCUMENT)[number];
  @ApiProperty({ enum: POLITIQUES_MENTION_SECURITE }) readonly mentionSecurite!: (typeof POLITIQUES_MENTION_SECURITE)[number];
}

export class VehiculeParametresAtelierDto {
  @ApiProperty() readonly expertiseAlerteMois!: number;
  @ApiProperty({ enum: VISIBILITES_HISTORIQUE_VEHICULE }) readonly visibiliteHistoriqueNouveauDetenteur!: (typeof VISIBILITES_HISTORIQUE_VEHICULE)[number];
}

export class RappelPlanningDto {
  @ApiProperty({ enum: CANAUX_RAPPEL }) readonly canal!: (typeof CANAUX_RAPPEL)[number];
  @ApiProperty() readonly joursAvant!: number;
}

export class PlanningParametresAtelierDto {
  @ApiProperty() readonly noShowSeuilAlerte!: number;
  @ApiProperty() readonly tamponPretMinutes!: number;
  @ApiProperty({
    type: () => RappelPlanningDto,
    description: 'Aucune colonne en base au lot 1 (domaine `planning` inerte) — valeur par défaut de contrats-api-etape-1.md §8.2.',
  })
  readonly rappel!: RappelPlanningDto;
}

/**
 * Drapeau d'étape (§8.2) : les QUATRE clés gelées de `ReponseParametresAtelier`. Toutes `false`
 * au lot 1 — aucune des quatre fonctionnalités n'existe encore. Calculé, jamais stocké.
 */
export class FonctionnalitesAtelierDto {
  @ApiProperty({ example: false }) readonly facturation!: boolean;
  @ApiProperty({ example: false }) readonly stockPieces!: boolean;
  @ApiProperty({ example: false }) readonly depotPneus!: boolean;
  @ApiProperty({ example: false }) readonly prets!: boolean;
}

export class ReponseParametresAtelierDto {
  @ApiProperty({ type: () => OrParametresAtelierDto }) readonly or!: OrParametresAtelierDto;
  @ApiProperty({ type: () => ReceptionParametresAtelierDto }) readonly reception!: ReceptionParametresAtelierDto;
  @ApiProperty({ type: () => TravauxParametresAtelierDto }) readonly travaux!: TravauxParametresAtelierDto;
  @ApiProperty({ type: () => FacturationParametresAtelierDto }) readonly facturation!: FacturationParametresAtelierDto;
  @ApiProperty({ type: () => DocumentsParametresAtelierDto }) readonly documents!: DocumentsParametresAtelierDto;
  @ApiProperty({ type: () => VehiculeParametresAtelierDto }) readonly vehicule!: VehiculeParametresAtelierDto;
  @ApiProperty({ type: () => PlanningParametresAtelierDto }) readonly planning!: PlanningParametresAtelierDto;
  @ApiProperty({ type: () => FonctionnalitesAtelierDto }) readonly fonctionnalites!: FonctionnalitesAtelierDto;
  @ApiProperty({
    description:
      'Sert l\'ETag (`W/"<version>"`) et la revalidation conditionnelle (`If-None-Match`). ' +
      'Dérivé de `modifie_le` (aucune colonne de révision dédiée en base) — signalé.',
    example: 1785312862000,
  })
  readonly version!: number;
}
