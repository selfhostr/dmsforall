import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  STATUTS_VEHICULE,
  type GarantieVehicule,
  type ImportationVehicule,
  type MotifArchivageVehicule,
  type PageCurseur,
  type ReponseVehicule,
  type StatutVehicule,
  type VehiculeResume,
} from '@dfa/shared';

export class ImportationVehiculeDto implements ImportationVehicule {
  @ApiProperty()
  readonly estImporte!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'DE' })
  readonly paysOrigine!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly importeLe!: string | null;
}

export class GarantieVehiculeDto implements GarantieVehicule {
  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly debutLe!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly finLe!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly plafondKm!: number | null;

  @ApiProperty()
  readonly active!: boolean;
}

export class ReponseVehiculeDto implements ReponseVehicule {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'WVGZZZ1TZJW123456' })
  readonly vin!: string | null;

  @ApiProperty({ example: 'VW' })
  readonly marque!: string;

  @ApiProperty({ example: 'Touran' })
  readonly modele!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly version!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly finition!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1ZM431' })
  readonly codeTypeCh!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly premiereMiseEnCirculationLe!: string | null;

  @ApiProperty({ example: 'VW Touran 2.0 TDI' })
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true, example: 'VD 123456' })
  readonly plaque!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VD' })
  readonly canton!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly carburant!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly cylindreeCm3!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly puissanceKw!: number | null;

  @ApiProperty({ type: String, nullable: true })
  readonly boite!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly transmission!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly normeEmission!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly couleur!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly codeCouleur!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly poidsVideKg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly poidsTotalKg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly places!: number | null;

  @ApiProperty({ type: String, nullable: true })
  readonly pneusEte!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly pneusHiver!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly pressionPneus!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly huileType!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly huileQuantiteDl!: number | null;

  @ApiProperty({ type: String, nullable: true })
  readonly batterie!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly codeRadio!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly codeCle!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly intervalleEntretienKm!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly intervalleEntretienMois!: number | null;

  @ApiProperty({ type: () => ImportationVehiculeDto })
  readonly importe!: ImportationVehicule;

  @ApiProperty({ type: () => GarantieVehiculeDto, nullable: true })
  readonly garantieConstructeur!: GarantieVehicule | null;

  @ApiProperty({ type: () => GarantieVehiculeDto, nullable: true })
  readonly garantieGarage!: GarantieVehicule | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly proprietaireEconomiqueClientId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly conducteurHabituel!: string | null;

  @ApiProperty()
  readonly identificationIncomplete!: boolean;

  @ApiProperty({ enum: STATUTS_VEHICULE })
  readonly statut!: StatutVehicule;

  @ApiProperty({ type: String, nullable: true })
  readonly motifArchivage!: MotifArchivageVehicule | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly fusionneVersVehiculeId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

export class VehiculeResumeDto implements VehiculeResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly plaque!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly canton!: string | null;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly vin!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly premiereMiseEnCirculationLe!: string | null;

  @ApiProperty()
  readonly identificationIncomplete!: boolean;
}

export class PageVehiculeResumeDto implements PageCurseur<VehiculeResumeDto> {
  @ApiProperty({ type: () => [VehiculeResumeDto] })
  readonly donnees!: readonly VehiculeResumeDto[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Opaque base64url ; null = fin de liste.',
  })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
