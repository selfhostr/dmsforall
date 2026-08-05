import { ApiProperty } from '@nestjs/swagger';
import { LANGUES } from '@dfa/shared';
import { STATUTS_CLIENT, TYPES_CLIENT, type ClientResume, type VehiculeResume } from '@dfa/shared';

/**
 * Projections `ClientResume`/`VehiculeResume`, embarquées dans `ReponseOrdreReparation.client`/
 * `.vehicule` (§8.3). Copies locales au module `atelier` — même doctrine que
 * `dto/avertissement.dto.ts` (pas de dépendance de compilation vers `clients/`/`vehicules/`, dont
 * les contrôleurs sont écrits en parallèle par d'autres experts).
 */
export class ClientResumeOrDto implements ClientResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'CL-000123' })
  readonly numeroClient!: string;

  @ApiProperty({
    description: 'Rendu d’affichage calculé par le serveur (raisonSociale, ou nom prenom).',
  })
  readonly nomAffiche!: string;

  @ApiProperty({ enum: TYPES_CLIENT })
  readonly type!: ClientResume['type'];

  @ApiProperty({ enum: STATUTS_CLIENT })
  readonly statut!: ClientResume['statut'];

  @ApiProperty({ enum: LANGUES })
  readonly langueCorrespondance!: ClientResume['langueCorrespondance'];

  @ApiProperty({ description: 'RM-14 : impose `numeroCommandeInterne` sur les OR de ce client.' })
  readonly poObligatoire!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Colonne directe de la fiche client.' })
  readonly telephone!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Localité de l'adresse PRINCIPALE active du client. `null` si aucune adresse.",
  })
  readonly localite!: string | null;

  @ApiProperty({ description: 'Véhicules actuellement détenus (détentions ouvertes).' })
  readonly nombreVehicules!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Dérivée du dernier OR ouvert.',
  })
  readonly dernierPassageLe!: string | null;
}

export class VehiculeResumeOrDto implements VehiculeResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ type: String, nullable: true, example: 'VD 123456' })
  readonly plaque!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'VD' })
  readonly canton!: string | null;

  @ApiProperty({ example: 'VW Touran 2.0 TDI' })
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true, example: 'WVGZZZ1TZJW123456' })
  readonly vin!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  readonly premiereMiseEnCirculationLe!: string | null;

  @ApiProperty()
  readonly identificationIncomplete!: boolean;

  @ApiProperty({ type: String, nullable: true, example: 'Devant, place 3' })
  readonly emplacementLibre!: string | null;
}
