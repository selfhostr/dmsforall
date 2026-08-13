import { ApiProperty } from '@nestjs/swagger';
import type { ReponseMotifRendezVous } from '@dfa/shared';

/** `GET /motifs-rendez-vous` — référentiel `motif_rendez_vous` (RV-01/RV-02). */
export class ReponseMotifRendezVousDto implements ReponseMotifRendezVous {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'SERVICE' })
  readonly code!: string;

  @ApiProperty({ example: 'Entretien / service courant' })
  readonly libelleFr!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly libelleDe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly libelleIt!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'RV-02 : non nul seulement pour un motif à créneau réel (expertise, remorquage…).',
  })
  readonly dureeDefautMinutes!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'RV-01 : non nul seulement pour un motif qui consomme de la capacité de journée.',
  })
  readonly heuresAtelierDefautCentiemes!: number | null;

  @ApiProperty()
  readonly actif!: boolean;
}
