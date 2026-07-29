import { ApiProperty } from '@nestjs/swagger';
import { CODES_AVERTISSEMENT, type Avertissement } from '@dfa/shared';

/**
 * `avertissements[]` de l'enveloppe d'écriture (contrats-api-etape-1.md §7.1). Présent même vide
 * sur toute création/modification — `CLIENT_DOUBLON_PROBABLE` (RM-05, CT-01) en est l'exemple
 * canonique côté clients : succès AVEC réserve, jamais un refus.
 */
export class AvertissementDto implements Avertissement {
  @ApiProperty({
    enum: CODES_AVERTISSEMENT,
    example: 'CLIENT_DOUBLON_PROBABLE',
    description: 'Traduit côté front via `erreurs:codes.<CODE>` — jamais affiché tel quel.',
  })
  readonly code!: Avertissement['code'];

  @ApiProperty({ description: 'Libellé FR stable (support, logs). Jamais affiché par le front.' })
  readonly message!: string;

  // Pas de `type: 'object'` ici : combiné à `required: false` (booléen), il fait basculer
  // `SchemaObjectMetadata` vers sa variante objet où `required` attend un `string[]`, pas un
  // booléen (TS2322). `additionalProperties` est déjà porté par la variante par défaut — la forme
  // est intentionnellement libre (`Record<string, unknown>` dans le contrat `Avertissement` gelé,
  // `donnees` variant par code d'avertissement), donc pas de classe DTO dédiée possible ici.
  @ApiProperty({ required: false, additionalProperties: true })
  readonly donnees?: Readonly<Record<string, unknown>>;
}
