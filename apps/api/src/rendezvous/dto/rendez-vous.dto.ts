import { ApiProperty } from '@nestjs/swagger';
import {
  MOMENTS_RENDEZ_VOUS,
  ORIGINES_RDV,
  STATUTS_RDV,
  TYPES_ORDRE_REPARATION,
  type ClientResume,
  type MomentRendezVous,
  type OrigineRdv,
  type ReponseMotifRendezVous,
  type ReponseRendezVous,
  type StatutRdv,
  type TypeOrdreReparation,
  type VehiculeResume,
} from '@dfa/shared';

import { ClientResumeOrDto, VehiculeResumeOrDto } from '../../atelier/dto';

import { ReponseMotifRendezVousDto } from './motif-rendez-vous.dto';

/**
 * `ReponseRendezVous` (document complet) — même doctrine que `ReponseOrdreReparationDto` : après
 * toute écriture (création, déplacement, arrivée, absence, annulation), l'appelant relit le
 * rendez-vous entier dans l'enveloppe, jamais un second aller-retour.
 */
export class ReponseRendezVousDto implements ReponseRendezVous {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ type: () => ClientResumeOrDto })
  readonly client!: ClientResume;

  @ApiProperty({ type: () => VehiculeResumeOrDto, nullable: true })
  readonly vehicule!: VehiculeResume | null;

  @ApiProperty({ enum: TYPES_ORDRE_REPARATION })
  readonly type!: TypeOrdreReparation;

  @ApiProperty({ type: () => ReponseMotifRendezVousDto })
  readonly motif!: ReponseMotifRendezVous;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Verbatim secondaire, jamais un substitut au motif.',
  })
  readonly commentaire!: string | null;

  @ApiProperty({ format: 'date', example: '2026-08-20' })
  readonly dateLe!: string;

  @ApiProperty({ enum: MOMENTS_RENDEZ_VOUS })
  readonly moment!: MomentRendezVous;

  @ApiProperty({ type: String, nullable: true, example: '08:00' })
  readonly heureSouhaitee!: string | null;

  @ApiProperty({ description: 'Figée à la création depuis le motif, modifiable ensuite.' })
  readonly dureeEstimeeMinutes!: number;

  @ApiProperty({ enum: STATUTS_RDV })
  readonly statut!: StatutRdv;

  @ApiProperty({ type: String, nullable: true })
  readonly motifAnnulation!: string | null;

  @ApiProperty({ enum: ORIGINES_RDV })
  readonly origine!: OrigineRdv;

  @ApiProperty({ format: 'date-time' })
  readonly confirmeLe!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly honoreLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly absentConstateLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly annuleLe!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "L'OR déjà créé par ce rendez-vous (mode « OR anticipé »). `null` tant qu'aucun n'existe.",
  })
  readonly ordreReparationId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly creeParId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}
