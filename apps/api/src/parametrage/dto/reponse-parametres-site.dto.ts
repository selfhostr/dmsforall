import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO Swagger de `GET /sites/{siteId}/parametres-atelier` (contrats-api-etape-1.md §8.2, dernier
 * paragraphe — P-20 capacité, P-31 heure de clôture pointage, greffés sur `/sites/{id}` du socle).
 */
export class ReponseParametresSiteDto {
  @ApiProperty({ format: 'uuid' }) readonly siteId!: string;
  @ApiProperty({ type: String, nullable: true, example: '08:00', description: 'Format `HH:MM`.' })
  readonly heureOuverture!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '18:00', description: 'Format `HH:MM`.' })
  readonly heureFermeture!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'P-31 : heure de clôture automatique des pointages ouverts.',
  })
  readonly heureCloturePointage!: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'P-20. `null` = non saisie — jamais `0` (une barre de charge à zéro serait un mensonge).',
  })
  readonly capaciteHeuresJourCentiemes!: number | null;
  @ApiProperty({ type: [String], example: ['2026-12-25', '2027-01-01'] })
  readonly joursFermeture!: readonly string[];
  @ApiProperty({ description: 'Sert l\'ETag (`W/"<version>"`). Dérivé de `modifie_le`.' })
  readonly version!: number;
}
