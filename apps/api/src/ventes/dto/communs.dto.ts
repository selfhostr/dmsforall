import { ApiProperty } from '@nestjs/swagger';
import {
  LANGUES,
  STATUTS_CLIENT,
  TYPES_CLIENT,
  type ClientResume,
  type VehiculeResume,
} from '@dfa/shared';

/**
 * Projections partagées entre les DTO de ce module (véhicule, client) — copies module-locales des
 * types `VehiculeResume`/`ClientResume` (`@dfa/shared`), même doctrine que `clients/dto/`,
 * `vehicules/dto/`, `atelier/dto/` : chaque module Nest porte ses propres classes DTO annotées
 * `@ApiProperty` (NestJS/Swagger lit les métadonnées sur la classe concrète, jamais sur un alias
 * TypeScript effacé à la compilation) — pas de dépendance de compilation vers un autre module
 * d'expert.
 */

export class VehiculeResumeDto implements VehiculeResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly plaque!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly canton!: string | null;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly vin!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  readonly premiereMiseEnCirculationLe!: string | null;

  @ApiProperty()
  readonly identificationIncomplete!: boolean;
}

export class ClientResumeDto implements ClientResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly numeroClient!: string;

  @ApiProperty()
  readonly nomAffiche!: string;

  @ApiProperty({ enum: TYPES_CLIENT })
  readonly type!: ClientResume['type'];

  @ApiProperty({ enum: STATUTS_CLIENT })
  readonly statut!: ClientResume['statut'];

  @ApiProperty({ enum: LANGUES })
  readonly langueCorrespondance!: ClientResume['langueCorrespondance'];

  @ApiProperty()
  readonly poObligatoire!: boolean;

  @ApiProperty({ type: String, nullable: true })
  readonly telephone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly localite!: string | null;

  @ApiProperty()
  readonly nombreVehicules!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly dernierPassageLe!: string | null;
}

export class ModifieParDto {
  @ApiProperty({ format: 'uuid' })
  readonly utilisateurId!: string;

  @ApiProperty()
  readonly nomAffiche!: string;
}
