import { ApiProperty } from '@nestjs/swagger';

/** DTO Swagger — `GET /referentiels/vehicules/marques`. */
export class MarqueVehiculeChDto {
  @ApiProperty({ example: 'VW' }) readonly nom!: string;
  @ApiProperty({ example: 959, description: 'Nombre de modèles distincts du référentiel.' })
  readonly nombreModeles!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Volkswagen',
    description:
      '`null` quand la marque a été trouvée directement (nom canonique ASTRA). Sinon, le terme ' +
      "d'alias qui a permis de la trouver (ex. « Volkswagen » pour la marque canonique « VW ») — " +
      'un utilisateur qui tape le nom courant et voit le sigle ASTRA apparaître doit comprendre ' +
      'pourquoi.',
  })
  readonly aliasTrouve!: string | null;
}

export class ReponseMarquesVehiculesChDto {
  @ApiProperty({ type: () => [MarqueVehiculeChDto] })
  readonly marques!: readonly MarqueVehiculeChDto[];
}

/** DTO Swagger — `GET /referentiels/vehicules/modeles`. */
export class ModeleVehiculeChDto {
  @ApiProperty({ example: 'GOLF' }) readonly nom!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    example: '1AA101',
    description:
      'Code type ASTRA, seulement quand ce nom de modèle correspond à un unique code type pour ' +
      'la marque demandée — `null` si plusieurs motorisations/variantes le partagent.',
  })
  readonly codeTypeCh!: string | null;
}

export class ReponseModelesVehiculesChDto {
  @ApiProperty({ type: () => [ModeleVehiculeChDto] })
  readonly modeles!: readonly ModeleVehiculeChDto[];
}
