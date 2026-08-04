import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  RESULTATS_EXPERTISE,
  SOURCES_ECHEANCE_EXPERTISE,
  type ReponseVehiculeExpertise,
  type ResultatExpertise,
  type SourceEcheanceExpertise,
} from '@dfa/shared';

export class ReponseVehiculeExpertiseDto implements ReponseVehiculeExpertise {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'date' })
  readonly dateLe!: string;

  @ApiProperty({ enum: RESULTATS_EXPERTISE })
  readonly resultat!: ResultatExpertise;

  @ApiProperty({ type: String, nullable: true })
  readonly defauts!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly delaiContreVisiteLe!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly dateContreVisiteLe!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, format: 'date' })
  readonly prochaineEcheanceLe!: string | null;

  @ApiProperty({
    enum: SOURCES_ECHEANCE_EXPERTISE,
    description: 'Une convocation prime toujours (RM-28, CT-10).',
  })
  readonly sourceEcheance!: SourceEcheanceExpertise;
}
