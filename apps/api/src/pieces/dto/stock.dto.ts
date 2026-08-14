import { ApiProperty } from '@nestjs/swagger';
import {
  STATUTS_SUIVI_STOCK_ARTICLE,
  type LigneReapprovisionnement,
  type PageCurseur,
  type ReponseDisponibiliteArticle,
  type ReponseStockArticle,
  type ReservationActiveResume,
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

  @ApiProperty({
    description: 'quantitePhysiqueMillieme - quantiteReserveeMillieme (RP-14), dérivé.',
  })
  readonly quantiteDisponibleMillieme!: number;

  @ApiProperty({ type: String, nullable: true })
  readonly emplacement!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Casier structuré (rayon, 0056), COMPLÉMENT de `emplacement` — jamais un remplacement. ' +
      'Toujours normalisé (majuscules, sans espace) : "B3", "b3" et "B 3" saisis produisent la ' +
      'même valeur.',
  })
  readonly rayon!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Casier structuré (tiroir, 0056) — mêmes règles de normalisation que `rayon`.',
  })
  readonly tiroir!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly stockMinimumMillieme!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'RP-12 : le fournisseur vend par lot, pas à l’unité.',
  })
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

  @ApiProperty({
    description:
      "Fiable UNIQUEMENT si statutSuivi = 'suivi' ; sinon vaut 0 par convention et NE DOIT PAS " +
      'être lu comme un stock nul — voir statutSuivi.',
  })
  readonly quantiteDisponibleMillieme!: number;

  @ApiProperty({
    enum: STATUTS_SUIVI_STOCK_ARTICLE,
    description:
      "Suivi de stock au site demandé : 'suivi' (quantités fiables, y compris à 0), " +
      "'nonSuiviSurCeSite' (suivi ailleurs, inconnu ici) ou 'nonSuiviNullePart' (jamais mis en " +
      'stock). À lire AVANT les quantités ci-dessus.',
  })
  readonly statutSuivi!: ReponseDisponibiliteArticle['statutSuivi'];

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

  @ApiProperty({
    description:
      'stockMinimumMillieme - quantiteDisponibleMillieme, toujours > 0 dans cette liste.',
  })
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
