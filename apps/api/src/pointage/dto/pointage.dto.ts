import { ApiProperty } from '@nestjs/swagger';
import {
  ACTIVITES_INDIRECTES,
  MOTIFS_ANOMALIE_POINTAGE,
  NATURES_ACTIVITE_POINTAGE,
  SOURCES_POINTAGE,
  STATUTS_POINTAGE,
  type AnomaliePointage,
  type DerniereCorrectionPointage,
  type MotifAnomaliePointage,
  type ReponsePointage,
} from '@dfa/shared';

/** DTO Swagger de `AnomaliePointage` (RM-91, RM-96, RM-123). */
export class AnomaliePointageDto implements AnomaliePointage {
  @ApiProperty({ enum: MOTIFS_ANOMALIE_POINTAGE })
  readonly motif!: MotifAnomaliePointage;

  @ApiProperty({ format: 'date-time' })
  readonly detecteeLe!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly traiteeLe!: string | null;
}

/** DTO Swagger de `DerniereCorrectionPointage` (RM-94). */
export class DerniereCorrectionPointageDto implements DerniereCorrectionPointage {
  @ApiProperty()
  readonly motif!: string;

  @ApiProperty({ format: 'uuid' })
  readonly parUtilisateurId!: string;

  @ApiProperty({ format: 'date-time' })
  readonly corrigeeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly debutLeOrigine!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly finLeOrigine!: string | null;
}

/** DTO Swagger de la ressource `pointage` (RM-87 → RM-99, RM-113 → RM-123). */
export class ReponsePointageDto implements ReponsePointage {
  @ApiProperty({
    format: 'uuid',
    description:
      'Fourni par le client à la création (idempotence hors ligne) — jamais généré par le serveur.',
  })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly technicienId!: string;

  @ApiProperty({ enum: STATUTS_POINTAGE })
  readonly statut!: ReponsePointage['statut'];

  @ApiProperty({
    enum: NATURES_ACTIVITE_POINTAGE,
    description: 'Discriminant des trois cibles RM-87.',
  })
  readonly nature!: ReponsePointage['nature'];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ligneOrId!: string | null;

  @ApiProperty({ enum: ACTIVITES_INDIRECTES, nullable: true })
  readonly activiteIndirecte!: ReponsePointage['activiteIndirecte'];

  @ApiProperty({ enum: SOURCES_POINTAGE })
  readonly source!: ReponsePointage['source'];

  @ApiProperty({ type: String, nullable: true })
  readonly appareilId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly debutLe!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly finLe!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'RM-97 : brut, jamais recalculé — `null` tant que le pointage est ouvert.',
  })
  readonly dureeBruteSecondes!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Arrondi selon P-19 — `null` tant que le pointage est ouvert.',
  })
  readonly dureeArrondieCentiemes!: number | null;

  @ApiProperty({
    description: 'RM-89 (chevauchement) ou RM-91/RM-119 (clôture de fin de journée).',
  })
  readonly clotureAutomatique!: boolean;

  @ApiProperty({ type: () => AnomaliePointageDto, nullable: true })
  readonly anomalie!: AnomaliePointage | null;

  @ApiProperty({ type: () => DerniereCorrectionPointageDto, nullable: true })
  readonly derniereCorrection!: DerniereCorrectionPointage | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}
