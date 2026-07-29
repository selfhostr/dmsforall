import { ApiProperty } from '@nestjs/swagger';
import {
  TYPES_ADRESSE,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseClientAdresse,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class ClientAdresseDto implements ReponseClientAdresse {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: TYPES_ADRESSE })
  readonly type!: ReponseClientAdresse['type'];

  @ApiProperty()
  readonly rue!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly complement!: string | null;

  @ApiProperty()
  readonly npa!: string;

  @ApiProperty()
  readonly localite!: string;

  @ApiProperty({ example: 'CH' })
  readonly pays!: string;

  @ApiProperty()
  readonly actif!: boolean;
}

export class PageClientAdresseDto implements PageCurseur<ClientAdresseDto> {
  @ApiProperty({ type: () => [ClientAdresseDto] })
  readonly donnees!: readonly ClientAdresseDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class ClientAdresseAvecAvertissementsDto implements ReponseAvecAvertissements<ClientAdresseDto> {
  @ApiProperty({ type: () => ClientAdresseDto })
  readonly donnees!: ClientAdresseDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
