import { ApiProperty } from '@nestjs/swagger';
import { CODES_AVERTISSEMENT, type Avertissement } from '@dfa/shared';

/**
 * `avertissements[]` de l'enveloppe d'écriture (contrats-api-etape-1.md §7.1). Copie module-locale
 * — même périmètre disjoint que `pagination-triee.ts`, voir son en-tête.
 */
export class AvertissementDto implements Avertissement {
  @ApiProperty({
    enum: CODES_AVERTISSEMENT,
    example: 'PIECE_RESERVATION_INDISPONIBLE',
    description: 'Traduit côté front via `erreurs:codes.<CODE>` — jamais affiché tel quel.',
  })
  readonly code!: Avertissement['code'];

  @ApiProperty({ description: 'Libellé FR stable (support, logs). Jamais affiché par le front.' })
  readonly message!: string;

  @ApiProperty({ required: false, additionalProperties: true })
  readonly donnees?: Readonly<Record<string, unknown>>;
}
