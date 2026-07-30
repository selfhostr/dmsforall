import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CODES_AVERTISSEMENT, type Avertissement, type CodeAvertissement } from '@dfa/shared';

/** DTO Swagger de `Avertissement` — copie locale au module `facturation`, même doctrine que
 *  `atelier/dto/avertissement.dto.ts` : chaque module porte ses propres DTO. */
export class AvertissementDocumentDto implements Avertissement {
  @ApiProperty({ enum: CODES_AVERTISSEMENT })
  readonly code!: CodeAvertissement;

  @ApiProperty({ description: 'Libellé FR stable — jamais affiché tel quel par le front.' })
  readonly message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  readonly donnees?: Readonly<Record<string, unknown>>;
}
