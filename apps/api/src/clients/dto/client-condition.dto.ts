import { ApiProperty } from '@nestjs/swagger';
import type { PageCurseur, ReponseAvecAvertissements, ReponseClientCondition } from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

/** Conditions commerciales DATÉES (RM-07). Figées sur l'OR à sa création (RM-50) — les modifier n'altère aucun OR existant. */
export class ClientConditionDto implements ReponseClientCondition {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 0 })
  readonly rabaisMoPourmille!: number;

  @ApiProperty({ example: 0 })
  readonly rabaisPiecesPourmille!: number;

  @ApiProperty({ example: 0 })
  readonly rabaisPneusPourmille!: number;

  @ApiProperty({ type: String, nullable: true })
  readonly tauxHoraireCode!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly delaiPaiementJours!: number | null;

  @ApiProperty({ type: String, nullable: true })
  readonly modePaiement!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly plafondCentimes!: number | null;

  @ApiProperty({ format: 'date' })
  readonly valideDuLe!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true, description: 'null = ouvert.' })
  readonly valideAuLe!: string | null;
}

export class PageClientConditionDto implements PageCurseur<ClientConditionDto> {
  @ApiProperty({ type: () => [ClientConditionDto] })
  readonly donnees!: readonly ClientConditionDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class ClientConditionAvecAvertissementsDto implements ReponseAvecAvertissements<ClientConditionDto> {
  @ApiProperty({ type: () => ClientConditionDto })
  readonly donnees!: ClientConditionDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
