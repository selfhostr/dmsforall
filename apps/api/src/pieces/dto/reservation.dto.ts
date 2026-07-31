import { ApiProperty } from '@nestjs/swagger';
import {
  MOTIFS_LIBERATION_RESERVATION,
  STATUTS_RESERVATION_PIECE,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseReservationPiece,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class ReservationPieceDto implements ReponseReservationPiece {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ligneOrId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty()
  readonly quantiteMillieme!: number;

  @ApiProperty({ enum: STATUTS_RESERVATION_PIECE })
  readonly statut!: ReponseReservationPiece['statut'];

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly satisfaiteLe!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly mouvementSortieId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly libereeLe!: string | null;

  @ApiProperty({ enum: MOTIFS_LIBERATION_RESERVATION, nullable: true })
  readonly motifLiberation!: ReponseReservationPiece['motifLiberation'];

  @ApiProperty({ type: String, nullable: true })
  readonly motifLiberationTexte!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly libereeParUtilisateurId!: string | null;
}

export class ReservationPieceAvecAvertissementsDto implements ReponseAvecAvertissements<ReservationPieceDto> {
  @ApiProperty({ type: () => ReservationPieceDto })
  readonly donnees!: ReservationPieceDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}

export class PageReservationPieceDto implements PageCurseur<ReservationPieceDto> {
  @ApiProperty({ type: () => [ReservationPieceDto] })
  readonly donnees!: readonly ReservationPieceDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
