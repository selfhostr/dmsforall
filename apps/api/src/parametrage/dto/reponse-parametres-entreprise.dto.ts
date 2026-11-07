import { ApiProperty } from '@nestjs/swagger';
import type { ReponseParametresEntreprise } from '@dfa/shared';

/** DTO Swagger de `GET|PATCH /parametres-entreprise` (garde de compilation : `implements`). */
export class ReponseParametresEntrepriseDto implements ReponseParametresEntreprise {
  @ApiProperty({ example: 'Garage Martin SA' })
  readonly raisonSociale!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'CHE-116.281.710 TVA',
    description:
      'N° IDE avec mention TVA (CHE-123.456.789 TVA, MWST ou IVA), clé de contrôle vérifiée. `null` : garage non assujetti ou numéro pas encore saisi.',
  })
  readonly numeroTva!: string | null;
}
