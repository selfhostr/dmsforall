import { ApiProperty } from '@nestjs/swagger';
import {
  DISPONIBILITES_COURTOISIE,
  ETATS_STOCKES_VEHICULE_COURTOISIE,
  STATUTS_PRET_COURTOISIE_UTILISES,
  type DisponibiliteCourtoisie,
  type EtatStockeVehiculeCourtoisie,
  type ReponseListeVehiculesCourtoisie,
  type ReponsePretCourtoisie,
  type ReponseVehiculeCourtoisie,
  type StatutPretCourtoisieUtilise,
} from '@dfa/shared';

export class ReponsePretCourtoisieDto implements ReponsePretCourtoisie {
  @ApiProperty({ format: 'uuid' }) readonly id!: string;
  @ApiProperty({ format: 'uuid' }) readonly vehiculeCourtoisieId!: string;
  @ApiProperty() readonly vehiculeDesignation!: string;
  @ApiProperty({ type: String, nullable: true }) readonly vehiculePlaque!: string | null;
  @ApiProperty({ format: 'uuid' }) readonly clientId!: string;
  @ApiProperty() readonly clientNom!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly rendezVousId!: string | null;
  @ApiProperty({ format: 'date-time' }) readonly debutLe!: string;
  @ApiProperty({ format: 'date-time' }) readonly finPrevueLe!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly renduLe!: string | null;
  @ApiProperty({ type: Number, nullable: true }) readonly kmDepart!: number | null;
  @ApiProperty({ type: Number, nullable: true }) readonly kmRetour!: number | null;
  @ApiProperty({ enum: STATUTS_PRET_COURTOISIE_UTILISES })
  readonly statut!: StatutPretCourtoisieUtilise;
  @ApiProperty({ description: 'Prêt en cours dont la fin prévue est dépassée.' })
  readonly enRetard!: boolean;
  @ApiProperty({ type: String, nullable: true }) readonly note!: string | null;
  @ApiProperty({ format: 'date-time' }) readonly creeLe!: string;
}

export class ReponseVehiculeCourtoisieDto implements ReponseVehiculeCourtoisie {
  @ApiProperty({ format: 'uuid' }) readonly id!: string;
  @ApiProperty() readonly designation!: string;
  @ApiProperty({ type: String, nullable: true }) readonly plaque!: string | null;
  @ApiProperty({ type: Number, nullable: true }) readonly kilometrage!: number | null;
  @ApiProperty({ enum: ETATS_STOCKES_VEHICULE_COURTOISIE })
  readonly etat!: EtatStockeVehiculeCourtoisie;
  @ApiProperty({ type: String, nullable: true }) readonly note!: string | null;
  @ApiProperty({ enum: DISPONIBILITES_COURTOISIE })
  readonly disponibilite!: DisponibiliteCourtoisie;
  @ApiProperty({ type: () => ReponsePretCourtoisieDto, nullable: true })
  readonly pretSurPeriode!: ReponsePretCourtoisie | null;
}

export class ReponseListeVehiculesCourtoisieDto implements ReponseListeVehiculesCourtoisie {
  @ApiProperty({ format: 'date-time' }) readonly du!: string;
  @ApiProperty({ format: 'date-time' }) readonly au!: string;
  @ApiProperty({ type: () => [ReponseVehiculeCourtoisieDto] })
  readonly vehicules!: readonly ReponseVehiculeCourtoisie[];
}
