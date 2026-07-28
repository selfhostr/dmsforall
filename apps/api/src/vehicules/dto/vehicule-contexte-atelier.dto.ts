import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  LANGUES,
  SOURCES_ECHEANCE_EXPERTISE,
  SOURCES_KILOMETRAGE,
  STATUTS_CLIENT,
  UNITES_DISTANCE,
  type Avertissement,
  type GarantieVehicule,
  type ImportationVehicule,
  type Langue,
  type ReponseContexteAtelier,
  type ReponseTravailReporte,
  type SourceEcheanceExpertise,
  type SourceKilometrage,
  type StatutClient,
  type UniteDistance,
} from '@dfa/shared';

import { AvertissementVehiculeDto } from './avertissement.dto';
import { GarantieVehiculeDto, ImportationVehiculeDto } from './vehicule.dto';
import { ReponseTravailReporteDto } from './vehicule-travail-reporte.dto';

/**
 * DTO Swagger de `ReponseContexteAtelier` (`GET /vehicules/{vehiculeId}/contexte-atelier`, §8.1,
 * RM-36). Copie locale au module (même doctrine que les autres DTO de `vehicules/dto/`) — les
 * classes imbriquées ne réutilisent PAS `ReponseVehiculeDto`/`ReponseVehiculeDetentionDto` : la
 * forme de l'agrégat est volontairement plus étroite que la ressource complète (RM-36 : ce que le
 * comptoir doit voir d'un coup, pas la fiche véhicule entière).
 */

class VehiculeContexteAtelierDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'VD 123456' })
  readonly plaque!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VD' })
  readonly canton!: string | null;

  @ApiProperty({ example: 'VW Touran 2.0 TDI' })
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly premiereMiseEnCirculationLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly vin!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly codeTypeCh!: string | null;

  @ApiProperty({ type: () => ImportationVehiculeDto })
  readonly importe!: ImportationVehicule;

  @ApiProperty()
  readonly identificationIncomplete!: boolean;
}

class DetenteurCourantContexteDto {
  @ApiProperty({ format: 'uuid' })
  readonly clientId!: string;

  @ApiProperty({ example: 'C-004128' })
  readonly numeroClient!: string;

  @ApiProperty({ example: 'Meier Hans' })
  readonly nom!: string;

  @ApiProperty({ enum: LANGUES })
  readonly langueCorrespondance!: Langue;

  @ApiProperty({ enum: STATUTS_CLIENT })
  readonly statut!: StatutClient;

  @ApiProperty({ format: 'date' })
  readonly depuisLe!: string;

  @ApiProperty()
  readonly poObligatoire!: boolean;
}

class DernierKilometrageContexteDto {
  @ApiProperty()
  readonly valeurKm!: number;

  @ApiProperty({ enum: UNITES_DISTANCE })
  readonly unite!: UniteDistance;

  @ApiProperty({ format: 'date-time' })
  readonly releveLe!: string;

  @ApiProperty({ enum: SOURCES_KILOMETRAGE })
  readonly source!: SourceKilometrage;
}

class ExpertiseContexteDto {
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly derniereLe!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly prochaineLe!: string | null;

  @ApiProperty({ enum: SOURCES_ECHEANCE_EXPERTISE, description: 'Une convocation prime toujours (RM-28, CT-10).' })
  readonly source!: SourceEcheanceExpertise;

  @ApiProperty({ description: 'Calculé serveur — jamais recalculé côté client.' })
  readonly echue!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  readonly joursDepuisEcheance!: number | null;
}

class GarantieContexteDto {
  @ApiProperty({ type: () => GarantieVehiculeDto, nullable: true })
  readonly constructeur!: GarantieVehicule | null;

  @ApiProperty({ type: () => GarantieVehiculeDto, nullable: true })
  readonly garage!: GarantieVehicule | null;
}

class CampagneOuverteContexteDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: '23K7' })
  readonly code!: string;

  @ApiProperty()
  readonly description!: string;

  @ApiProperty()
  readonly obligatoire!: boolean;
}

class TravauxReportesContexteDto {
  @ApiProperty({ description: 'Compte réel des travaux OUVERTS — peut dépasser `elements.length` (borné).' })
  readonly total!: number;

  @ApiProperty({ type: () => [ReponseTravailReporteDto], description: `Borné à MAX_TRAVAUX_REPORTES_CONTEXTE (10).` })
  readonly elements!: readonly ReponseTravailReporte[];
}

class AlerteClientContexteDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: ['alerte'] })
  readonly nature!: 'alerte';

  @ApiProperty()
  readonly texte!: string;
}

class OrdreReparationOuvertContexteDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly numero!: string;

  @ApiProperty()
  readonly statut!: string;
}

export class ReponseContexteAtelierDto implements ReponseContexteAtelier {
  @ApiProperty({ type: () => VehiculeContexteAtelierDto })
  readonly vehicule!: VehiculeContexteAtelierDto;

  @ApiProperty({ type: () => DetenteurCourantContexteDto, nullable: true })
  readonly detenteurCourant!: DetenteurCourantContexteDto | null;

  @ApiProperty({ type: () => DernierKilometrageContexteDto, nullable: true })
  readonly dernierKilometrage!: DernierKilometrageContexteDto | null;

  @ApiProperty({ type: () => ExpertiseContexteDto, nullable: true })
  readonly expertise!: ExpertiseContexteDto | null;

  @ApiProperty({ type: () => GarantieContexteDto })
  readonly garantie!: GarantieContexteDto;

  @ApiProperty({ type: () => [CampagneOuverteContexteDto] })
  readonly campagnesOuvertes!: readonly CampagneOuverteContexteDto[];

  @ApiProperty({ type: () => TravauxReportesContexteDto })
  readonly travauxReportes!: TravauxReportesContexteDto;

  @ApiProperty({ type: () => [AlerteClientContexteDto] })
  readonly alertesClient!: readonly AlerteClientContexteDto[];

  @ApiProperty({ type: () => [OrdreReparationOuvertContexteDto], description: 'Alimente la confirmation VEHICULE_DEUX_OR_OUVERTS (P-29).' })
  readonly ordresReparationOuverts!: readonly OrdreReparationOuvertContexteDto[];

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    example: null,
    description:
      "Réservé à l'hôtel à pneus — toujours `null` au lot 1 (place retenue dans le contrat). " +
      "`type` fixé explicitement : le type TS `null` seul ne produit aucune métadonnée " +
      '`design:type` côté `emitDecoratorMetadata` (TypeScript ne sait pas sérialiser un type ' +
      "littéral `null`), ce qui faisait échouer la génération Swagger au démarrage avec un faux " +
      'positif « circular dependency » (voir schema-object-factory.js, createNotBuiltInTypeReference).',
  })
  readonly depotPneus!: null;

  @ApiProperty({ type: () => [AvertissementVehiculeDto] })
  readonly avertissements!: readonly Avertissement[];
}
