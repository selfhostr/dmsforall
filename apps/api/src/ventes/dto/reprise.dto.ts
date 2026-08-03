import { ApiProperty } from '@nestjs/swagger';
import { ACTIONS_REPRISE, STATUTS_REPRISE, type ReponseAvecAvertissements, type ReponseReprise, type RepriseResume } from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';
import { ModifieParDto, VehiculeResumeDto } from './communs.dto';

export class RepriseResumeDto implements RepriseResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: () => VehiculeResumeDto })
  readonly vehiculeRepris!: VehiculeResumeDto;

  @ApiProperty({ enum: STATUTS_REPRISE })
  readonly statut!: RepriseResume['statut'];

  @ApiProperty()
  readonly valeurEstimeeCentimes!: number;

  @ApiProperty({ type: Number, nullable: true })
  readonly valeurNegocieeCentimes!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Dérivé : valeurNegocieeCentimes - valeurEstimeeCentimes (RV-21).' })
  readonly ecartRepriseVehiculeCentimes!: number | null;
}

export class ReponseRepriseDto implements ReponseReprise {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly dossierVenteId!: string;

  @ApiProperty({ type: () => VehiculeResumeDto })
  readonly vehiculeRepris!: VehiculeResumeDto;

  @ApiProperty({ enum: STATUTS_REPRISE })
  readonly statut!: ReponseReprise['statut'];

  @ApiProperty()
  readonly valeurEstimeeCentimes!: number;

  @ApiProperty({ type: Number, nullable: true })
  readonly valeurNegocieeCentimes!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Dérivé (RV-21) — jamais utilisé pour une base TVA (RV-22/QV-05, non tranché).' })
  readonly ecartRepriseVehiculeCentimes!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'RV-26/CV-02 : solde de financement encore dû sur le véhicule repris.' })
  readonly detteFinancementResiduelleCentimes!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly detteFinancementOrganismeId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly detteFinancementOrganismeNom!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly estimeeLe!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly negocieeLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly confirmeeLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly refuseeLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motifRefus!: string | null;

  @ApiProperty({ enum: ACTIONS_REPRISE, isArray: true })
  readonly actionsDisponibles!: ReponseReprise['actionsDisponibles'];

  @ApiProperty()
  readonly version!: number;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;

  @ApiProperty({ type: () => ModifieParDto, nullable: true })
  readonly modifiePar!: ModifieParDto | null;
}

export class RepriseAvecAvertissementsDto implements ReponseAvecAvertissements<ReponseRepriseDto> {
  @ApiProperty({ type: () => ReponseRepriseDto })
  readonly donnees!: ReponseRepriseDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
