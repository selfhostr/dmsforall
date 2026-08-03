import { ApiProperty } from '@nestjs/swagger';
import {
  ACTIONS_VEHICULE_STOCK,
  STATUTS_COMMERCIAUX_VEHICULE,
  TYPES_VEHICULE_VENTE,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseVehiculeStock,
  type VehiculeStockResume,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';
import { ModifieParDto, VehiculeResumeDto } from './communs.dto';

export class VehiculeStockResumeDto implements VehiculeStockResume {
  @ApiProperty({ format: 'uuid', description: 'EST vehicule.id — pas de second identifiant (RV-01).' })
  readonly id!: string;

  @ApiProperty({ type: () => VehiculeResumeDto })
  readonly vehicule!: VehiculeResumeDto;

  @ApiProperty({ description: 'Liste EXTENSIBLE par tenant (RV-02) — texte libre côté contrat, pas un enum PG fermé.' })
  readonly provenance!: VehiculeStockResume['provenance'];

  @ApiProperty({ enum: TYPES_VEHICULE_VENTE, description: 'Dérivé, jamais saisi (§8.2).' })
  readonly typeVehicule!: VehiculeStockResume['typeVehicule'];

  @ApiProperty({ enum: STATUTS_COMMERCIAUX_VEHICULE })
  readonly statutCommercial!: VehiculeStockResume['statutCommercial'];

  @ApiProperty({ type: Number, nullable: true })
  readonly prixVenteAfficheCentimes!: number | null;

  @ApiProperty({ description: 'Jours écoulés depuis dateEntreeStock (RV-07), calculé à la lecture.' })
  readonly joursStock!: number;
}

export class ReponseVehiculeStockDto implements ReponseVehiculeStock {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ type: () => VehiculeResumeDto })
  readonly vehicule!: VehiculeResumeDto;

  @ApiProperty({ description: 'Liste EXTENSIBLE par tenant (RV-02).' })
  readonly provenance!: ReponseVehiculeStock['provenance'];

  @ApiProperty({ type: String, format: 'date' })
  readonly dateEntreeStock!: string;

  @ApiProperty({ description: 'Centimes, obligatoire dès l’entrée en stock (RV-03).' })
  readonly prixAchatCentimes!: number;

  @ApiProperty({
    description:
      'Dérivé, somme des OR de type interne liés (RV-04). [À VALIDER, QV-02] — LECTURE SEULE, ' +
      "vaut 0 tant que l'accroche OR interne -> véhicule en stock n'est pas tranchée.",
  })
  readonly fraisRemiseEtatCumulesCentimes!: number;

  @ApiProperty({ type: Number, nullable: true })
  readonly prixVenteAfficheCentimes!: number | null;

  @ApiProperty({ enum: STATUTS_COMMERCIAUX_VEHICULE })
  readonly statutCommercial!: ReponseVehiculeStock['statutCommercial'];

  @ApiProperty({ enum: TYPES_VEHICULE_VENTE, description: 'Dérivé, jamais saisi (§8.2).' })
  readonly typeVehicule!: ReponseVehiculeStock['typeVehicule'];

  @ApiProperty({ type: Boolean, nullable: true, description: 'RV-60 : null sauf provenance ∈ {reprise, achat_particulier}.' })
  readonly vendeurPrecedentAssujetti!: boolean | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly origineRepriseDossierVenteId!: string | null;

  @ApiProperty({ description: 'RV-07, calculé à la lecture — jamais stocké.' })
  readonly joursStock!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly receptionneLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly reserveLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly venduLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly livreLe!: string | null;

  @ApiProperty({ enum: ACTIONS_VEHICULE_STOCK, isArray: true })
  readonly actionsDisponibles!: ReponseVehiculeStock['actionsDisponibles'];

  @ApiProperty()
  readonly version!: number;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;

  @ApiProperty({ type: () => ModifieParDto, nullable: true })
  readonly modifiePar!: ModifieParDto | null;
}

export class PageVehiculeStockResumeDto implements PageCurseur<VehiculeStockResumeDto> {
  @ApiProperty({ type: () => [VehiculeStockResumeDto] })
  readonly donnees!: readonly VehiculeStockResumeDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Opaque base64url ; null = fin de liste.' })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class PageVehiculeStockDto implements PageCurseur<ReponseVehiculeStockDto> {
  @ApiProperty({ type: () => [ReponseVehiculeStockDto] })
  readonly donnees!: readonly ReponseVehiculeStockDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Opaque base64url ; null = fin de liste.' })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class VehiculeStockAvecAvertissementsDto implements ReponseAvecAvertissements<ReponseVehiculeStockDto> {
  @ApiProperty({ type: () => ReponseVehiculeStockDto })
  readonly donnees!: ReponseVehiculeStockDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
