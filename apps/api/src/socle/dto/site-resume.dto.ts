import { ApiProperty } from '@nestjs/swagger';
import type { SiteResume } from '@dfa/shared';

export class SiteResumeDto implements SiteResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'SION' })
  readonly code!: string;

  @ApiProperty({ example: 'Sion' })
  readonly nom!: string;

  @ApiProperty()
  readonly actif!: boolean;
}
