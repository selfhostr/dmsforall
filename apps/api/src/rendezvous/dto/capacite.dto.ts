import { ApiProperty } from '@nestjs/swagger';
import {
  ETATS_CAPACITE_RENDEZ_VOUS,
  MOMENTS_RENDEZ_VOUS,
  type CapaciteJourRendezVous,
  type EtatCapaciteRendezVous,
  type MomentRendezVous,
  type ReponseCapaciteRendezVous,
} from '@dfa/shared';

/**
 * `GET /rendez-vous/capacite` — RV-06/RV-07/RV-08. `capaciteMinutes: null` + `etat:
 * 'non_definie'` sur un site jamais paramétré : JAMAIS rendu comme `0` ni `'disponible'` (règle
 * maison, quatre défauts produits cette semaine par leur confusion).
 */
export class CapaciteJourRendezVousDto implements CapaciteJourRendezVous {
  @ApiProperty({ format: 'date', example: '2026-08-20' })
  readonly dateLe!: string;

  @ApiProperty({ enum: MOMENTS_RENDEZ_VOUS })
  readonly moment!: MomentRendezVous;

  @ApiProperty()
  readonly minutesOccupees!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: '`null` = capacité jamais paramétrée pour ce site (RV-08) — jamais `0`.',
  })
  readonly capaciteMinutes!: number | null;

  @ApiProperty({ enum: ETATS_CAPACITE_RENDEZ_VOUS })
  readonly etat!: EtatCapaciteRendezVous;
}

export class ReponseCapaciteRendezVousDto implements ReponseCapaciteRendezVous {
  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ type: () => [CapaciteJourRendezVousDto] })
  readonly jours!: readonly CapaciteJourRendezVous[];
}
