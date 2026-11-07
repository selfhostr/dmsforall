import { ApiProperty } from '@nestjs/swagger';
import { TYPES_MIME_LOGO, type ReponseLogoEntreprise } from '@dfa/shared';

export class ReponseLogoEntrepriseDto implements ReponseLogoEntreprise {
  @ApiProperty({ enum: TYPES_MIME_LOGO })
  readonly typeMime!: ReponseLogoEntreprise['typeMime'];

  @ApiProperty({ description: 'Taille du fichier, en octets.' })
  readonly tailleOctets!: number;
}
