import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CANAUX_DEVIS,
  DECISIONS_DEVIS,
  type ReponseDevisComplementaire,
  type ReponseDevisLigne,
} from '@dfa/shared';

export class ReponseDevisLigneDto implements ReponseDevisLigne {
  @ApiProperty({ format: 'uuid' })
  readonly ligneId!: string;

  @ApiProperty({
    enum: DECISIONS_DEVIS,
    nullable: true,
    description: "`null` tant que le devis n'a pas reçu de réponse `partiel` (CT-33).",
  })
  readonly decision!: ReponseDevisLigne['decision'];
}

export class ReponseDevisComplementaireDto implements ReponseDevisComplementaire {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty({ description: 'Rang du devis dans l’OR (1, 2, 3…).' })
  readonly numeroOrdre!: number;

  @ApiProperty({ type: () => [ReponseDevisLigneDto] })
  readonly lignes!: readonly ReponseDevisLigne[];

  @ApiPropertyOptional({
    description:
      'Absent pour un rôle sans droit aux montants. Calculé par le serveur depuis les lignes référencées.',
  })
  readonly montantTtcCentimes?: number;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly nouveauPlafondCentimes?: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly impactRestitutionLe!: string | null;

  @ApiProperty({ enum: CANAUX_DEVIS })
  readonly canal!: ReponseDevisComplementaire['canal'];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly destinataireContactId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly envoyeLe!: string;

  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: {
      utilisateurId: { type: 'string', format: 'uuid' },
      nomAffiche: { type: 'string' },
    },
  })
  readonly emetteur!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Le NOM DE LA PERSONNE qui a répondu (RM-81). Obligatoire dès qu’il y a une réponse.',
  })
  readonly interlocuteurNom!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly repondueLe!: string | null;

  @ApiProperty({ enum: DECISIONS_DEVIS, nullable: true })
  readonly decision!: ReponseDevisComplementaire['decision'];

  @ApiProperty({ type: String, nullable: true })
  readonly retranscription!: string | null;
}
