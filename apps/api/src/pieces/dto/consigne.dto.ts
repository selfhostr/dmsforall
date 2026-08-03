import { ApiProperty } from '@nestjs/swagger';
import {
  STATUTS_CONSIGNE_ECHANGE_STANDARD,
  type PageCurseur,
  type ReponseConsigneEchangeStandard,
} from '@dfa/shared';

export class ConsigneEchangeStandardDto implements ReponseConsigneEchangeStandard {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ligneOrId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ enum: STATUTS_CONSIGNE_ECHANGE_STANDARD })
  readonly statut!: ReponseConsigneEchangeStandard['statut'];

  @ApiProperty({ description: 'TTC, figé à la pose (RP-38/RP-42).' })
  readonly montantConsigneTtcCentimes!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Alimenté par la facturation (RF-100), hors périmètre de ce module.',
  })
  readonly documentVenteLigneConsigneId!: string | null;

  @ApiProperty({ format: 'uuid' })
  readonly mouvementEntreeId!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly retourneeFournisseurLe!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly mouvementRetourId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Alimenté par la facturation (RF-100), hors périmètre de ce module.',
  })
  readonly avoirDocumentId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;
}

export class PageConsigneEchangeStandardDto implements PageCurseur<ConsigneEchangeStandardDto> {
  @ApiProperty({ type: () => [ConsigneEchangeStandardDto] })
  readonly donnees!: readonly ConsigneEchangeStandardDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
