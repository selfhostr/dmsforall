import { ApiProperty } from '@nestjs/swagger';
import type { SiteAffecteResume } from '@dfa/shared';

export class SiteAffecteResumeDto implements SiteAffecteResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'Sion' })
  readonly nom!: string;
}
