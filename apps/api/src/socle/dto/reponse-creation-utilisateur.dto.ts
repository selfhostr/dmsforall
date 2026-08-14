import { ApiProperty } from '@nestjs/swagger';
import type { ReponseCreationUtilisateur } from '@dfa/shared';
import { ReponseAccesTemporaireDto } from './reponse-acces-temporaire.dto';
import { UtilisateurResumeDto } from './utilisateur-resume.dto';

export class ReponseCreationUtilisateurDto implements ReponseCreationUtilisateur {
  @ApiProperty({ type: () => UtilisateurResumeDto })
  readonly utilisateur!: UtilisateurResumeDto;

  @ApiProperty({ type: () => ReponseAccesTemporaireDto })
  readonly acces!: ReponseAccesTemporaireDto;
}
