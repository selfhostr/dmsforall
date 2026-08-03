import { ApiProperty } from '@nestjs/swagger';
import {
  ACTIONS_FINANCEMENT,
  STATUTS_CONFIRMATION_FINANCEMENT,
  TYPES_FINANCEMENT_VENTE,
  type FinancementResume,
  type ReponseAvecAvertissements,
  type ReponseFinancement,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';
import { ClientResumeDto } from './communs.dto';

/** Projection légère de client pour les résumés financement (id + nomAffiche seulement). */
export class FinancementOrganismeResumeDto {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly nomAffiche!: string;
}

export class FinancementResumeDto implements FinancementResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: TYPES_FINANCEMENT_VENTE })
  readonly type!: FinancementResume['type'];

  @ApiProperty({ type: () => FinancementOrganismeResumeDto, nullable: true })
  readonly organisme!: FinancementOrganismeResumeDto | null;

  @ApiProperty({ enum: STATUTS_CONFIRMATION_FINANCEMENT })
  readonly statutConfirmation!: FinancementResume['statutConfirmation'];
}

export class ReponseFinancementDto implements ReponseFinancement {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly dossierVenteId!: string;

  @ApiProperty({ enum: TYPES_FINANCEMENT_VENTE })
  readonly type!: ReponseFinancement['type'];

  @ApiProperty({
    type: () => ClientResumeDto,
    nullable: true,
    description:
      'null UNIQUEMENT pour type = comptant (RV-44). Organisme de financement (client tiers si crédit/leasing).',
  })
  readonly organisme!: ClientResumeDto | null;

  @ApiProperty({ type: String, nullable: true })
  readonly referenceContrat!: string | null;

  @ApiProperty({ enum: STATUTS_CONFIRMATION_FINANCEMENT })
  readonly statutConfirmation!: ReponseFinancement['statutConfirmation'];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly confirmeLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly refuseLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motifRefus!: string | null;

  @ApiProperty({ enum: ACTIONS_FINANCEMENT, isArray: true })
  readonly actionsDisponibles!: ReponseFinancement['actionsDisponibles'];

  @ApiProperty()
  readonly version!: number;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

export class FinancementAvecAvertissementsDto implements ReponseAvecAvertissements<ReponseFinancementDto> {
  @ApiProperty({ type: () => ReponseFinancementDto })
  readonly donnees!: ReponseFinancementDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
