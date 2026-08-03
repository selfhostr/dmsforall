import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STATUTS_TRAVAIL_REPORTE, URGENCES_TRAVAIL, type ReponseTravailReporte, type StatutTravailReporte, type UrgenceTravail } from '@dfa/shared';

export class ReponseTravailReporteDto implements ReponseTravailReporte {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ enum: URGENCES_TRAVAIL })
  readonly urgence!: UrgenceTravail;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Absent pour les rôles de ROLES_SANS_MONTANT.' })
  readonly montantEstimeCentimes?: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly kilometrageAlors!: number | null;

  @ApiProperty({ format: 'date' })
  readonly constateLe!: string;

  @ApiProperty()
  readonly securite!: boolean;

  @ApiProperty({ enum: STATUTS_TRAVAIL_REPORTE })
  readonly statut!: StatutTravailReporte;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationOrigineId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ligneOrOrigineId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationRepriseId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "Raison d'une correction ou d'un abandon ultérieur (distincte du motif de refus initial au devis). Non filtrée par rôle.",
  })
  readonly motifModification!: string | null;
}
