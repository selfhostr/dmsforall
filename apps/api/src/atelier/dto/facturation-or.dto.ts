import { ApiProperty } from '@nestjs/swagger';
import type {
  ReponseDocumentVente,
  ReponseFacturationOrdreReparation,
  ReponseOrdreReparation,
} from '@dfa/shared';

import { ReponseDocumentVenteDto } from '../../facturation/documents/dto';

import { ReponseOrdreReparationDto } from './ordre-reparation.dto';

/**
 * `POST /ordres-reparation/{orId}/facturer` (`RF-81`) — LE PONT entre l'atelier et la facturation,
 * voir `packages/shared/src/contrats/facturation/facturer-or.ts` (contrat figé, fait foi). DTO
 * Swagger seulement : composé de deux DTO déjà posés dans deux périmètres différents
 * (`atelier/dto` et `facturation/documents/dto`), tous deux propriété de ce lot pour cette
 * tâche — pas une dépendance croisée inter-experts.
 */
export class ReponseFacturationOrdreReparationDto implements ReponseFacturationOrdreReparation {
  @ApiProperty({
    type: () => [ReponseDocumentVenteDto],
    description:
      'Un brouillon par groupe payeur traité par CET appel, dans l’ordre de `groupes` en entrée.',
  })
  readonly facturesCreees!: readonly ReponseDocumentVente[];

  @ApiProperty({
    type: () => ReponseOrdreReparationDto,
    description: "L'OR à jour — même patron que les actions de §7.7.",
  })
  readonly ordreReparation!: ReponseOrdreReparation;
}
