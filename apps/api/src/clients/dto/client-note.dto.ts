import { ApiProperty } from '@nestjs/swagger';
import {
  NATURES_NOTE,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseClientNote,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

class AuteurNoteDto {
  @ApiProperty({ format: 'uuid' })
  readonly utilisateurId!: string;

  @ApiProperty()
  readonly nomAffiche!: string;
}

/** `nature: alerte` remonte dans le contexte-atelier et à chaque ouverture de fiche (RM-13, RM-36). */
export class ClientNoteDto implements ReponseClientNote {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: NATURES_NOTE })
  readonly nature!: ReponseClientNote['nature'];

  @ApiProperty()
  readonly texte!: string;

  @ApiProperty({ type: () => AuteurNoteDto, nullable: true })
  readonly auteur!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;
}

export class PageClientNoteDto implements PageCurseur<ClientNoteDto> {
  @ApiProperty({ type: () => [ClientNoteDto] })
  readonly donnees!: readonly ClientNoteDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class ClientNoteAvecAvertissementsDto implements ReponseAvecAvertissements<ClientNoteDto> {
  @ApiProperty({ type: () => ClientNoteDto })
  readonly donnees!: ClientNoteDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
