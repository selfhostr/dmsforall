import { ApiProperty } from '@nestjs/swagger';
import type { PageCurseur, VehiculeResume } from '@dfa/shared';

/**
 * Projection minimale d'un véhicule, embarquée ici pour `GET /clients/{id}/vehicules` et
 * `GET /clients/{id}/ordres-reparation`. Type frozen `@dfa/shared` — DTO redéfini localement
 * (le module véhicules, `apps/api/src/vehicules/**`, en possède probablement un homonyme ; à
 * réconcilier à l'intégration, voir la réponse de tâche).
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

export class PageVehiculeResumeDto implements PageCurseur<VehiculeResumeDto> {
  @ApiProperty({ type: () => [VehiculeResumeDto] })
  readonly donnees!: readonly VehiculeResumeDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
