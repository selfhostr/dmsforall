import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CODES_AVERTISSEMENT, type Avertissement, type CodeAvertissement } from '@dfa/shared';

/**
 * DTO Swagger de `Avertissement` (contrats-api-etape-1.md §4.4). Copie locale au module — même
 * doctrine que `ProblemeDetailCommunDto` (`common/erreurs/`) : chaque module porte ses propres DTO
 * Swagger pour ne pas créer de dépendance de compilation entre répertoires d'experts différents.
 */
export class AvertissementVehiculeDto implements Avertissement {
  @ApiProperty({ enum: CODES_AVERTISSEMENT })
  readonly code!: CodeAvertissement;

  @ApiProperty({ description: 'Libellé FR stable — jamais affiché tel quel par le front.' })
  readonly message!: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  readonly donnees?: Readonly<Record<string, unknown>>;
}
