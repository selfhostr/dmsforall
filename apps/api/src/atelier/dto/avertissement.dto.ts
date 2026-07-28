import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CODES_AVERTISSEMENT, type Avertissement, type CodeAvertissement } from '@dfa/shared';

/**
 * DTO Swagger de `Avertissement` (contrats-api-etape-1.md §4.4) — copie locale au module `atelier`,
 * même doctrine que `vehicules/dto/avertissement.dto.ts` et `clients/dto/avertissement.dto.ts` :
 * chaque module porte ses propres DTO pour ne pas créer de dépendance de compilation entre
 * répertoires d'experts différents.
 */
export class AvertissementOrDto implements Avertissement {
  @ApiProperty({ enum: CODES_AVERTISSEMENT })
  readonly code!: CodeAvertissement;

  @ApiProperty({ description: 'Libellé FR stable — jamais affiché tel quel par le front.' })
  readonly message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  readonly donnees?: Readonly<Record<string, unknown>>;
}
