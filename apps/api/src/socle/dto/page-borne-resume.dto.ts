import { ApiProperty } from '@nestjs/swagger';
import type { BorneResume, PageCurseur } from '@dfa/shared';
import { BorneResumeDto } from './borne-resume.dto';

export class PageBorneResumeDto implements PageCurseur<BorneResume> {
  @ApiProperty({ type: () => [BorneResumeDto] })
  readonly donnees!: readonly BorneResumeDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque base64url ; null = fin de liste.',
  })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
