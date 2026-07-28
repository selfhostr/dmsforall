import { ApiProperty } from '@nestjs/swagger';
import type { PageCurseur, ReponseAvecAvertissements, ReponseClientConsentement } from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

/** APPEND-ONLY (RM-09, nLPD) : aucun `PATCH`/`DELETE`, une révocation est une NOUVELLE ligne `accorde: false`. */
export class ClientConsentementDto implements ReponseClientConsentement {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: ['marketing_email', 'marketing_sms', 'marketing_appel'] })
  readonly type!: ReponseClientConsentement['type'];

  @ApiProperty()
  readonly accorde!: boolean;

  @ApiProperty({ format: 'date-time' })
  readonly recueilliLe!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly canal!: string | null;
}

export class PageClientConsentementDto implements PageCurseur<ClientConsentementDto> {
  @ApiProperty({ type: () => [ClientConsentementDto] })
  readonly donnees!: readonly ClientConsentementDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class ClientConsentementAvecAvertissementsDto implements ReponseAvecAvertissements<ClientConsentementDto> {
  @ApiProperty({ type: () => ClientConsentementDto })
  readonly donnees!: ClientConsentementDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
