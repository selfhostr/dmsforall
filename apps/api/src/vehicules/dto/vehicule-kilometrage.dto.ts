import { ApiProperty } from '@nestjs/swagger';
import {
  SOURCES_KILOMETRAGE,
  UNITES_DISTANCE,
  type ReponseVehiculeKilometrage,
  type SourceKilometrage,
  type UniteDistance,
} from '@dfa/shared';

export class ReponseVehiculeKilometrageDto implements ReponseVehiculeKilometrage {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 187450 })
  readonly valeur!: number;

  @ApiProperty({ enum: UNITES_DISTANCE })
  readonly unite!: UniteDistance;

  @ApiProperty({ example: 187450, description: 'Converti en km par le serveur (CT-08).' })
  readonly valeurKm!: number;

  @ApiProperty({ format: 'date-time' })
  readonly releveLe!: string;

  @ApiProperty({ enum: SOURCES_KILOMETRAGE })
  readonly source!: SourceKilometrage;

  @ApiProperty({ type: String, nullable: true })
  readonly motifRegression!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationId!: string | null;
}
