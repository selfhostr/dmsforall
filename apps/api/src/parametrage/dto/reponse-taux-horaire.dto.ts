import { ApiProperty } from '@nestjs/swagger';

/** DTO Swagger — `GET|POST /referentiels/taux-horaires` (RM-65, datés). */
export class ReponseTauxHoraireDto {
  @ApiProperty({ format: 'uuid' }) readonly id!: string;
  @ApiProperty({ example: 'MEC' }) readonly code!: string;
  @ApiProperty({ example: 'Mécanique générale' }) readonly libelle!: string;
  @ApiProperty({ example: 14500, description: 'Centimes. `130.00 CHF/h` = `13000`.' })
  readonly montantCentimes!: number;
  @ApiProperty({ example: '2026-01-01' }) readonly valideDuLe!: string;
  @ApiProperty({ type: String, nullable: true, example: null }) readonly valideAuLe!: string | null;
}

export class PageTauxHoraireDto {
  @ApiProperty({ type: () => [ReponseTauxHoraireDto] })
  readonly donnees!: readonly ReponseTauxHoraireDto[];
  @ApiProperty({ type: String, nullable: true }) readonly curseurSuivant!: string | null;
  @ApiProperty() readonly limite!: number;
}
