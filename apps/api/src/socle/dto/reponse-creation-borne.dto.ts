import { ApiProperty } from '@nestjs/swagger';
import type { ReponseCreationBorne } from '@dfa/shared';
import { BorneResumeDto } from './borne-resume.dto';
import { ReponseAccesTemporaireDto } from './reponse-acces-temporaire.dto';

export class ReponseCreationBorneDto implements ReponseCreationBorne {
  @ApiProperty({ type: () => BorneResumeDto })
  readonly borne!: BorneResumeDto;

  @ApiProperty({ type: () => ReponseAccesTemporaireDto })
  readonly acces!: ReponseAccesTemporaireDto;
}
