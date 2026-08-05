import { ApiProperty } from '@nestjs/swagger';
import {
  MOTIFS_SORTIE_DEPOT_PNEUS,
  SAISONS_PNEU,
  STATUTS_DEPOT_PNEUS,
  type PageCurseur,
  type ReponseDepotPneus,
} from '@dfa/shared';

export class DepotPneusDto implements ReponseDepotPneus {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly vehiculeId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ enum: SAISONS_PNEU })
  readonly saison!: ReponseDepotPneus['saison'];

  @ApiProperty({ enum: STATUTS_DEPOT_PNEUS })
  readonly statut!: ReponseDepotPneus['statut'];

  @ApiProperty({ type: String, nullable: true })
  readonly codeCase!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly dimension!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly etat!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly entreLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly dernierMouvementLe!: string;

  @ApiProperty({ enum: MOTIFS_SORTIE_DEPOT_PNEUS, nullable: true })
  readonly motifSortie!: ReponseDepotPneus['motifSortie'];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ligneOrDernierChangementId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

export class PageDepotPneusDto implements PageCurseur<DepotPneusDto> {
  @ApiProperty({ type: () => [DepotPneusDto] })
  readonly donnees!: readonly DepotPneusDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
