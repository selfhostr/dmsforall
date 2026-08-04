import { ApiProperty } from '@nestjs/swagger';
import { TYPES_LIGNE_OR } from '@dfa/shared';

/** DTO Swagger — `GET|POST /referentiels/prestations` · `PATCH /{id}` (§7.9 de la spéc, prix historisés). */
export class DesignationPrestationDto {
  @ApiProperty({ example: 'Service A' }) readonly fr!: string;
  @ApiProperty({ example: 'Service A' }) readonly de!: string;
  @ApiProperty({ example: 'Service A' }) readonly it!: string;
}

export class ReponsePrestationDto {
  @ApiProperty({ format: 'uuid' }) readonly id!: string;
  @ApiProperty({ example: 'SRV-A' }) readonly code!: string;
  @ApiProperty({ type: () => DesignationPrestationDto })
  readonly designation!: DesignationPrestationDto;
  @ApiProperty({ enum: TYPES_LIGNE_OR }) readonly typeLigne!: (typeof TYPES_LIGNE_OR)[number];
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 120,
    description: "Centièmes d'heure. `120` = 1,2 h.",
  })
  readonly tempsBaremeCentiemes!: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'MEC' }) readonly tauxHoraireCode!:
    string | null;
  @ApiProperty({ example: 81, description: 'Pour mille. `81` = 8,1 %.' })
  readonly tauxTvaPourmille!: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    example: 19500,
    description: "Prix valide AUJOURD'HUI ; `null` si aucun prix n'est ouvert.",
  })
  readonly prixCentimes!: number | null;
  @ApiProperty() readonly actif!: boolean;
}

export class PagePrestationDto {
  @ApiProperty({ type: () => [ReponsePrestationDto] })
  readonly donnees!: readonly ReponsePrestationDto[];
  @ApiProperty({ type: String, nullable: true }) readonly curseurSuivant!: string | null;
  @ApiProperty() readonly limite!: number;
}
