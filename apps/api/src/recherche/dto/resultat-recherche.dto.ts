import { ApiProperty } from '@nestjs/swagger';
import {
  TYPES_RESULTAT_RECHERCHE,
  type ResultatRecherche,
  type TypeResultatRecherche,
} from '@dfa/shared';
import { CorrespondanceRechercheDto } from './correspondance-recherche.dto';

export class ResultatRechercheDto implements ResultatRecherche {
  @ApiProperty({ enum: TYPES_RESULTAT_RECHERCHE, enumName: 'TypeResultatRecherche' })
  readonly type!: TypeResultatRecherche;

  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ minimum: 0, maximum: 1, description: 'Pertinence, décroissante.' })
  readonly score!: number;

  @ApiProperty({ type: () => CorrespondanceRechercheDto })
  readonly correspondance!: CorrespondanceRechercheDto;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      "Résumé d'affichage, dépendant de `type`. Additif : de nouvelles clés peuvent apparaître, " +
      'jamais retirées. Les clés monétaires sont retirées côté serveur pour un rôle sans droit ' +
      'aux montants (aucune clé monétaire au lot 1 — voir la note de livraison).',
  })
  readonly resume!: Readonly<Record<string, unknown>>;
}
