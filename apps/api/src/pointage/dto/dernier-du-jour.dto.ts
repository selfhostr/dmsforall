import { ApiProperty } from '@nestjs/swagger';
import type { CibleReprisePointage, ReponseDernierPointageDuJour } from '@dfa/shared';

/**
 * DTO Swagger de `CibleReprisePointage`/`ReponseDernierPointageDuJour` (contrat gelé `@dfa/shared`,
 * `pointage/pointage.ts`) — réponse de `GET /pointages/dernier-du-jour`. Voir l'en-tête du contrat
 * pour le raisonnement complet (remplace l'état local volatile `dernierCible` de l'écran technicien).
 */
export class CibleReprisePointageDto implements CibleReprisePointage {
  @ApiProperty({
    enum: ['ligne', 'or'],
    description: 'Une cible `indirect` n’atteint jamais cette réponse.',
  })
  readonly type!: CibleReprisePointage['type'];

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty({ description: 'Résolu par le serveur — jamais reconstruit côté client.' })
  readonly numeroOr!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '`null` ⇔ `type === "or"`.',
  })
  readonly ligneOrId!: string | null;

  @ApiProperty({
    description:
      'Désignation de la ligne, ou à défaut le numéro de l’OR. Chaîne brute, jamais assemblée — le front compose.',
  })
  readonly libelle!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Résolu depuis le pointage lui-même, jamais depuis un paramètre.',
  })
  readonly siteId!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'Fin du dernier segment productif sur cette cible ; si ce segment est encore `en_cours` au moment de ' +
      'la requête, vaut l’instant de la requête (voir le commentaire du contrat pour cette interprétation).',
  })
  readonly interrompuLe!: string;

  @ApiProperty({
    description:
      'Somme des durées brutes (secondes, jamais arrondies) de tous les segments productifs d’aujourd’hui ' +
      'sur cette même cible, segment en cours inclus. Entier, jamais une chaîne formatée.',
  })
  readonly cumulSecondesDuJour!: number;
}

export class ReponseDernierPointageDuJourDto implements ReponseDernierPointageDuJour {
  @ApiProperty({ type: () => CibleReprisePointageDto, nullable: true })
  readonly cible!: CibleReprisePointage | null;
}
