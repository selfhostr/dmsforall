import { ApiProperty } from '@nestjs/swagger';
import {
  NIVEAUX_CONFIANCE_OCR,
  type CorrespondanceClientExistant,
  type CorrespondancesScan,
  type CorrespondanceVehiculeExistant,
  type DetenteurScanne,
  type DonneesPermisScanne,
  type NiveauConfianceOcr,
  type ReponseScanPermisCirculation,
  type VehiculeScanne,
} from '@dfa/shared';

/**
 * Un seul DTO GÉNÉRIQUE `ChampScanneDto<T>` n'existe pas ici : `@nestjs/swagger` dérive son
 * schéma OpenAPI par introspection de classe, pas par instanciation générique TypeScript — chaque
 * forme de valeur (texte, booléen) a donc sa propre classe concrète, toutes structurellement
 * identiques sur `valeur`/`confiance`.
 */
class ChampScanneTexteDto {
  @ApiProperty({ type: String, nullable: true })
  readonly valeur!: string | null;

  @ApiProperty({ enum: NIVEAUX_CONFIANCE_OCR })
  readonly confiance!: NiveauConfianceOcr;
}

class ChampScanneBooleenDto {
  @ApiProperty({ type: Boolean, nullable: true })
  readonly valeur!: boolean | null;

  @ApiProperty({ enum: NIVEAUX_CONFIANCE_OCR })
  readonly confiance!: NiveauConfianceOcr;
}

class VehiculeScanneDto implements VehiculeScanne {
  @ApiProperty({ type: ChampScanneTexteDto })
  readonly marque!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly modele!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly vin!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly plaque!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly canton!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto, description: 'Valeur ISO `aaaa-mm-jj` quand lue.' })
  readonly premiereMiseEnCirculationLe!: ChampScanneTexteDto;
}

class DetenteurScanneDto implements DetenteurScanne {
  @ApiProperty({ type: ChampScanneBooleenDto })
  readonly estEntreprise!: ChampScanneBooleenDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly nom!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly prenom!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly raisonSociale!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly rue!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly npa!: ChampScanneTexteDto;

  @ApiProperty({ type: ChampScanneTexteDto })
  readonly localite!: ChampScanneTexteDto;
}

class DonneesPermisScanneDto implements DonneesPermisScanne {
  @ApiProperty({ type: VehiculeScanneDto })
  readonly vehicule!: VehiculeScanneDto;

  @ApiProperty({ type: DetenteurScanneDto })
  readonly detenteur!: DetenteurScanneDto;
}

class CorrespondanceClientExistantDto implements CorrespondanceClientExistant {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly nomAffiche!: string;
}

class CorrespondanceVehiculeExistantDto implements CorrespondanceVehiculeExistant {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly libelle!: string;
}

class CorrespondancesScanDto implements CorrespondancesScan {
  @ApiProperty({ type: CorrespondanceClientExistantDto, required: false })
  readonly client?: CorrespondanceClientExistantDto;

  @ApiProperty({ type: CorrespondanceVehiculeExistantDto, required: false })
  readonly vehicule?: CorrespondanceVehiculeExistantDto;
}

export class ReponseScanPermisCirculationDto implements ReponseScanPermisCirculation {
  @ApiProperty({ type: DonneesPermisScanneDto })
  readonly donnees!: DonneesPermisScanneDto;

  @ApiProperty({ type: CorrespondancesScanDto })
  readonly correspondances!: CorrespondancesScanDto;
}
