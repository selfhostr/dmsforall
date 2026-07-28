import { ApiProperty } from '@nestjs/swagger';
import type { CorrespondanceRecherche } from '@dfa/shared';

export class CorrespondanceRechercheDto implements CorrespondanceRecherche {
  @ApiProperty({ example: 'plaque', description: 'Champ où la correspondance a été trouvée.' })
  readonly champ!: string;

  @ApiProperty({ example: 'VD 123456' })
  readonly valeur!: string;

  @ApiProperty({
    description:
      'CT-05/RM-17 : `true` quand la plaque a été portée par ce véhicule dans le passé. Le ' +
      'véhicule courant sort en premier, l\'historique est signalé, jamais confondu.',
  })
  readonly historique!: boolean;

  @ApiProperty({ required: false, example: '2025-02-01', description: "Date de fin de port de la plaque (si `historique`)." })
  readonly porteeJusquLe?: string;
}
