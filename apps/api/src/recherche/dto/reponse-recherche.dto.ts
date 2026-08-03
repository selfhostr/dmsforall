import { ApiProperty } from '@nestjs/swagger';
import type { ReponseRecherche } from '@dfa/shared';
import { ResultatRechercheDto } from './resultat-recherche.dto';

export class ReponseRechercheDto implements ReponseRecherche {
  @ApiProperty({ type: () => [ResultatRechercheDto] })
  readonly resultats!: readonly ResultatRechercheDto[];

  @ApiProperty({
    description:
      'RM-18/§6.9 : `true` quand la plaque cherchée est interchangeable — les DEUX véhicules sont ' +
      "alors présents dans `resultats`. Le serveur ne choisit jamais à la place de l'utilisateur.",
  })
  readonly plaqueInterchangeable!: boolean;
}
