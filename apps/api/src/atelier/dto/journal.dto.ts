import { ApiProperty } from '@nestjs/swagger';
import { ACTIONS_AUDITEES, ENTITES_AUDITEES, type ReponseEntreeJournal } from '@dfa/shared';

/** `GET /ordres-reparation/{orId}/journal` (RM-59, RM-111). */
export class ReponseEntreeJournalDto implements ReponseEntreeJournal {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: ENTITES_AUDITEES })
  readonly entite!: ReponseEntreeJournal['entite'];

  @ApiProperty({ format: 'uuid' })
  readonly entiteId!: string;

  @ApiProperty({ enum: ACTIONS_AUDITEES })
  readonly action!: ReponseEntreeJournal['action'];

  @ApiProperty({ format: 'date-time' })
  readonly survenuLe!: string;

  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: {
      utilisateurId: { type: 'string', format: 'uuid' },
      nomAffiche: { type: 'string' },
    },
  })
  readonly auteur!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    additionalProperties: true,
    description: 'Avant/après, restreints aux champs modifiés. Montants filtrés par rôle.',
  })
  readonly avant!: Readonly<Record<string, unknown>> | null;

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  readonly apres!: Readonly<Record<string, unknown>> | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motif!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Confirmations données lors du geste (§4.4) — un forçage se trace.',
  })
  readonly confirmations!: readonly string[];
}
