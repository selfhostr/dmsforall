import { ApiProperty } from '@nestjs/swagger';
import type {
  PeriodeResolueTableauBord,
  ReponseActiviteTableauBord,
  RepartitionStatutOrdreReparationTableauBord,
  StatutOrTableauBord,
} from '@dfa/shared';

export class PeriodeResolueTableauBordDto implements PeriodeResolueTableauBord {
  @ApiProperty({ format: 'date', description: 'Borne basse INCLUSE.' })
  readonly du!: string;

  @ApiProperty({ format: 'date', description: 'Borne haute INCLUSE.' })
  readonly au!: string;
}

export class RepartitionStatutOrdreReparationTableauBordDto implements RepartitionStatutOrdreReparationTableauBord {
  @ApiProperty({
    enum: ['planifie', 'ouvert', 'en_cours', 'controle', 'termine', 'facture'],
  })
  readonly statut!: StatutOrTableauBord;

  @ApiProperty()
  readonly nombre!: number;
}

export class ReponseActiviteTableauBordDto implements ReponseActiviteTableauBord {
  @ApiProperty({ type: PeriodeResolueTableauBordDto })
  readonly periode!: PeriodeResolueTableauBordDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly siteId!: string | null;

  @ApiProperty({ type: () => [RepartitionStatutOrdreReparationTableauBordDto] })
  readonly ordresReparationParStatut!: readonly RepartitionStatutOrdreReparationTableauBordDto[];

  @ApiProperty()
  readonly ordresReparationOuvertsPeriode!: number;

  @ApiProperty()
  readonly ordresReparationRestituesPeriode!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '`null` si aucun OR restitué sur la période (pas 0 : distinction délibérée).',
  })
  readonly delaiMoyenRestitutionMinutes!: number | null;

  @ApiProperty()
  readonly lignesEnAttenteValidation!: number;

  @ApiProperty()
  readonly articlesSousSeuilReapprovisionnement!: number;
}
