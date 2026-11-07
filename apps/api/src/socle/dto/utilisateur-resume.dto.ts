import { CapacitesPersonneDto } from '../../auth/dto/capacites.dto';
import { ApiProperty } from '@nestjs/swagger';
import { ROLES_PERSONNE, STATUTS_UTILISATEUR, type UtilisateurResume } from '@dfa/shared';
import { SiteAffecteResumeDto } from './site-affecte-resume.dto';

export class UtilisateurResumeDto implements UtilisateurResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'Julie' })
  readonly prenom!: string;

  @ApiProperty({ example: 'Rey' })
  readonly nom!: string;

  @ApiProperty({ example: 'julie.rey@garage-martin.ch' })
  readonly email!: string;

  @ApiProperty({ enum: ROLES_PERSONNE, example: 'technicien' })
  readonly role!: UtilisateurResume['role'];

  @ApiProperty({ type: () => CapacitesPersonneDto })
  readonly capacites!: CapacitesPersonneDto;

  @ApiProperty({ enum: STATUTS_UTILISATEUR, example: 'actif' })
  readonly statut!: UtilisateurResume['statut'];

  @ApiProperty({ type: () => [SiteAffecteResumeDto] })
  readonly sites!: readonly SiteAffecteResumeDto[];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly derniereConnexionLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  readonly creeLe!: string;
}
