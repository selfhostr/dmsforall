import { ApiProperty } from '@nestjs/swagger';
import type {
  LigneReapprovisionnement,
  PageCurseur,
  ReponseDisponibiliteArticle,
  ReponseStockArticle,
  ReservationActiveResume,
} from '@dfa/shared';

export class ReservationActiveResumeDto implements ReservationActiveResume {
  @ApiProperty({ format: 'uuid' })
  readonly reservationId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ligneOrId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty({ example: 'OR-1042' })
  readonly numeroOrdreReparation!: string;

  @ApiProperty()
  readonly clientNomAffichage!: string;

  @ApiProperty()
  readonly quantiteMillieme!: number;

  @ApiProperty({ format: 'date-time' })
  readonly reserveeLe!: string;
}

export class StockArticleDto implements ReponseStockArticle {
  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty()
  readonly quantitePhysiqueMillieme!: number;

  @ApiProperty()
  readonly quantiteReserveeMillieme!: number;

  @ApiProperty({ description: 'quantitePhysiqueMillieme - quantiteReserveeMillieme (RP-14), dérivé.' })
  readonly quantiteDisponibleMillieme!: number;

  @ApiProperty({ type: String, nullable: true })
  readonly emplacement!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly stockMinimumMillieme!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'RP-12 : le fournisseur vend par lot, pas à l’unité.' })
  readonly quantiteCommandeStandardMillieme!: number | null;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}

export class DisponibiliteArticleDto implements ReponseDisponibiliteArticle {
  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty()
  readonly quantitePhysiqueMillieme!: number;

  @ApiProperty()
  readonly quantiteReserveeMillieme!: number;

  @ApiProperty()
  readonly quantiteDisponibleMillieme!: number;

  @ApiProperty({ type: () => [ReservationActiveResumeDto] })
  readonly reservationsActives!: readonly ReservationActiveResumeDto[];

  @ApiProperty()
  readonly reservationsActivesTronquees!: boolean;
}

export class LigneReapprovisionnementDto implements LigneReapprovisionnement {
  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty()
  readonly numeroArticle!: string;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty()
  readonly quantiteDisponibleMillieme!: number;

  @ApiProperty()
  readonly stockMinimumMillieme!: number;

  @ApiProperty({ description: 'stockMinimumMillieme - quantiteDisponibleMillieme, toujours > 0 dans cette liste.' })
  readonly ecartMillieme!: number;

  @ApiProperty({ type: Number, nullable: true })
  readonly quantiteCommandeStandardMillieme!: number | null;
}

export class PageReapprovisionnementDto implements PageCurseur<LigneReapprovisionnementDto> {
  @ApiProperty({ type: () => [LigneReapprovisionnementDto] })
  readonly donnees!: readonly LigneReapprovisionnementDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
