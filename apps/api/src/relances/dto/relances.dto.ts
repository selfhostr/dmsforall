import { ApiProperty } from '@nestjs/swagger';
import {
  CANAUX_MESSAGE_CLIENT,
  TYPES_RELANCE,
  type ReponseEnvoiRelances,
  type ReponsePlanificationRelances,
  type ReponseRegleRelance,
} from '@dfa/shared';

export class RegleRelanceDto implements ReponseRegleRelance {
  @ApiProperty({ enum: TYPES_RELANCE })
  readonly typeRelance!: ReponseRegleRelance['typeRelance'];

  @ApiProperty()
  readonly actif!: boolean;

  @ApiProperty({ type: [Number] })
  readonly delaisJours!: readonly number[];

  @ApiProperty({ enum: CANAUX_MESSAGE_CLIENT, isArray: true })
  readonly canaux!: readonly ReponseRegleRelance['canaux'][number][];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly texteModeleId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly prereglageAppliqueLe!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

export class PlanificationRelancesDto implements ReponsePlanificationRelances {
  @ApiProperty({ example: 3 })
  readonly creees!: number;

  @ApiProperty({ example: 12 })
  readonly ignorees!: number;

  @ApiProperty()
  readonly encoreATraiter!: boolean;
}

export class EnvoiRelancesDto implements ReponseEnvoiRelances {
  @ApiProperty({ example: 5 })
  readonly envoyees!: number;

  @ApiProperty({ example: 0 })
  readonly echouees!: number;

  @ApiProperty({ example: 1 })
  readonly annulees!: number;

  @ApiProperty()
  readonly encoreATraiter!: boolean;
}
