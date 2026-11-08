import { ApiProperty } from '@nestjs/swagger';
import type { SiteResume } from '@dfa/shared';

export class SiteResumeDto implements SiteResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'SION' })
  readonly code!: string;

  @ApiProperty({ example: 'SION', description: 'Étiquette compacte, 1 à 5 caractères A-Z/0-9.' })
  readonly codeCourt!: string;

  @ApiProperty({ example: 'Sion' })
  readonly nom!: string;

  @ApiProperty()
  readonly actif!: boolean;
}
