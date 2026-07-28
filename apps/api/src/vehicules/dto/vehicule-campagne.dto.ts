import { ApiProperty } from '@nestjs/swagger';
import { STATUTS_CAMPAGNE, type ReponseVehiculeCampagne, type StatutCampagne } from '@dfa/shared';

export class ReponseVehiculeCampagneDto implements ReponseVehiculeCampagne {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: '23K7' })
  readonly code!: string;

  @ApiProperty()
  readonly description!: string;

  @ApiProperty()
  readonly obligatoire!: boolean;

  @ApiProperty({ enum: STATUTS_CAMPAGNE })
  readonly statut!: StatutCampagne;

  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  readonly closeLe!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationId!: string | null;
}
