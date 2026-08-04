import { ApiProperty } from '@nestjs/swagger';
import {
  ETATS_AFFICHES_ORDRE_REPARATION,
  LOCALISATIONS_VEHICULE,
  STATUTS_ORDRE_REPARATION,
  TYPES_ORDRE_REPARATION,
  type OrdreReparationResume,
  type PageCurseur,
} from '@dfa/shared';

import { ClientResumeDto } from './client.dto';
import { VehiculeResumeDto } from './vehicule-resume.dto';

/**
 * Projection `GET /clients/{id}/ordres-reparation` (RM-21). `totalTtcCentimes` absent pour un
 * rôle sans droit aux montants (`ROLES_SANS_MONTANT`, `auth/matrice-droits.ts`) — voir
 * `service-client-ordres-reparation.ts` pour le calcul et la réserve signalée sur `etatAffiche`.
 */
export class OrdreReparationResumeDto implements OrdreReparationResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly numero!: string;

  @ApiProperty({ enum: STATUTS_ORDRE_REPARATION })
  readonly statut!: OrdreReparationResume['statut'];

  @ApiProperty({
    enum: ETATS_AFFICHES_ORDRE_REPARATION,
    description:
      'Le statut, OU le drapeau d’attente le plus bloquant (priorité accord > pieces > externe), calculé côté serveur.',
  })
  readonly etatAffiche!: OrdreReparationResume['etatAffiche'];

  @ApiProperty({ enum: TYPES_ORDRE_REPARATION })
  readonly type!: OrdreReparationResume['type'];

  @ApiProperty({ enum: LOCALISATIONS_VEHICULE })
  readonly localisation!: OrdreReparationResume['localisation'];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly ouvertLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly restitutionPromiseLe!: string | null;

  @ApiProperty({ type: () => VehiculeResumeDto })
  readonly vehicule!: VehiculeResumeDto;

  @ApiProperty({ type: () => ClientResumeDto })
  readonly client!: ClientResumeDto;

  @ApiProperty()
  readonly nombreLignes!: number;

  @ApiProperty({
    required: false,
    description: 'Absent pour un rôle sans droit aux montants (ex. technicien).',
  })
  readonly totalTtcCentimes?: number;
}

export class PageOrdreReparationResumeDto implements PageCurseur<OrdreReparationResumeDto> {
  @ApiProperty({ type: () => [OrdreReparationResumeDto] })
  readonly donnees!: readonly OrdreReparationResumeDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
