import { ApiProperty } from '@nestjs/swagger';
import {
  LANGUES,
  ROLES_CONTACT,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseClientContact,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class ClientContactDto implements ReponseClientContact {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly nom!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly prenom!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly fonction!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly telephone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly telephoneE164!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly email!: string | null;

  @ApiProperty({ type: String, nullable: true, enum: LANGUES })
  readonly langue!: ReponseClientContact['langue'];

  @ApiProperty({ enum: ROLES_CONTACT, isArray: true, description: 'Rôles CUMULABLES (RM-04).' })
  readonly roles!: readonly ReponseClientContact['roles'][number][];

  @ApiProperty()
  readonly actif!: boolean;
}

export class PageClientContactDto implements PageCurseur<ClientContactDto> {
  @ApiProperty({ type: () => [ClientContactDto] })
  readonly donnees!: readonly ClientContactDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class ClientContactAvecAvertissementsDto implements ReponseAvecAvertissements<ClientContactDto> {
  @ApiProperty({ type: () => ClientContactDto })
  readonly donnees!: ClientContactDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
