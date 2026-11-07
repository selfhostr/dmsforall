import { ApiProperty } from '@nestjs/swagger';
import { STATUTS_UTILISATEUR, type BorneResume } from '@dfa/shared';
import { SiteAffecteResumeDto } from './site-affecte-resume.dto';

export class BorneResumeDto implements BorneResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'Atelier Sion' })
  readonly nom!: string;

  @ApiProperty({
    example: 'borne-3fa81c20@bornes.dmsforall.invalid',
    description: 'Identifiant de connexion de la tablette, généré par le serveur.',
  })
  readonly identifiant!: string;

  @ApiProperty({ type: () => SiteAffecteResumeDto })
  readonly site!: SiteAffecteResumeDto;

  @ApiProperty({ enum: STATUTS_UTILISATEUR, example: 'actif' })
  readonly statut!: BorneResume['statut'];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly derniereConnexionLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  readonly creeLe!: string;
}
