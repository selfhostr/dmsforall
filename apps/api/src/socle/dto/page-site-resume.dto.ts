import { ApiProperty } from '@nestjs/swagger';
import type { PageCurseur } from '@dfa/shared';
import { SiteResumeDto } from './site-resume.dto';

export class PageSiteResumeDto implements PageCurseur<SiteResumeDto> {
  @ApiProperty({ type: () => [SiteResumeDto] })
  readonly donnees!: readonly SiteResumeDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Opaque base64url ; null = fin de liste.' })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
