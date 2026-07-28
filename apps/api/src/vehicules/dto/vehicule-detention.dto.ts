import { ApiProperty } from '@nestjs/swagger';
import type { ReponseVehiculeDetention } from '@dfa/shared';

class ClientResumeDetentionDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'C-004128' })
  readonly numeroClient!: string;

  @ApiProperty({ example: 'Meier Hans' })
  readonly nomAffiche!: string;
}

export class ReponseVehiculeDetentionDto implements ReponseVehiculeDetention {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: () => ClientResumeDetentionDto })
  readonly client!: ClientResumeDetentionDto;

  @ApiProperty({ format: 'date' })
  readonly debutLe!: string;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly finLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motifFin!: string | null;
}
