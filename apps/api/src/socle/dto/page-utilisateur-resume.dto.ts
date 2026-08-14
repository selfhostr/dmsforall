import { ApiProperty } from '@nestjs/swagger';
import type { PageCurseur, UtilisateurResume } from '@dfa/shared';
import { UtilisateurResumeDto } from './utilisateur-resume.dto';

export class PageUtilisateurResumeDto implements PageCurseur<UtilisateurResume> {
  @ApiProperty({ type: () => [UtilisateurResumeDto] })
  readonly donnees!: readonly UtilisateurResumeDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque base64url ; null = fin de liste.',
  })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
