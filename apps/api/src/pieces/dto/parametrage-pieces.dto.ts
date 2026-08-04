import { ApiProperty } from '@nestjs/swagger';
import { METHODES_PRIX_ACHAT, type ReponseParametresPieces } from '@dfa/shared';

export class ParametresPiecesDto implements ReponseParametresPieces {
  @ApiProperty({
    description:
      'PP-01 : stock des autres sites visible en lecture (défaut proposé, RP-10, QP-01).',
  })
  readonly stockAutresSitesVisible!: boolean;

  @ApiProperty({
    description: 'PP-02 : forçage du stock négatif autorisé (rôle habilité, non tranché).',
  })
  readonly stockNegatifForcageAutorise!: boolean;

  @ApiProperty({
    enum: METHODES_PRIX_ACHAT,
    nullable: true,
    description: 'PP-03 : null tant que non arbitré (QP-04).',
  })
  readonly methodePrixAchat!: ReponseParametresPieces['methodePrixAchat'];

  @ApiProperty({
    enum: [true],
    description: 'PP-04 : hypothèse figée (RP-05), pas encore paramétrable.',
  })
  readonly conditionnementArticleDistinct!: true;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'PP-05 : null tant que non arbitré (QP-11).',
  })
  readonly seuilValeurAjustementSignificatifCentimes!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'PP-06 : null tant que non arbitré (QP-07).',
  })
  readonly delaiConsigneAcquisitionJours!: number | null;

  @ApiProperty({
    description: 'PP-07 : taux TVA de la consigne, en pourmille (défaut proposé 81 = 8.1%, QP-06).',
  })
  readonly tauxTvaConsignePourmille!: number;
}
