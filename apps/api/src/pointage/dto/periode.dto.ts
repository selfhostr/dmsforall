import { ApiProperty } from '@nestjs/swagger';
import type { ReponseDeverrouillagePeriodePointage, ReponseVerrouillagePeriodePointage } from '@dfa/shared';

/** DTO Swagger du rapport d'exécution de `POST /pointages/verrouiller-periode` (RM-95). */
export class ReponseVerrouillagePeriodePointageDto implements ReponseVerrouillagePeriodePointage {
  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ format: 'date', example: '2026-07-31' })
  readonly jusquauLe!: string;

  @ApiProperty()
  readonly pointagesVerrouilles!: number;
}

/** DTO Swagger du rapport d'exécution de `POST /pointages/deverrouiller-periode` (contre-passation, RM-95). */
export class ReponseDeverrouillagePeriodePointageDto implements ReponseDeverrouillagePeriodePointage {
  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ format: 'date', example: '2026-07-31' })
  readonly jusquauLe!: string;

  @ApiProperty()
  readonly pointagesDeverrouilles!: number;
}
