import { ApiProperty } from '@nestjs/swagger';
import type { AgregatTempsLigneOr, ReponseAgregatTempsLigne } from '@dfa/shared';

/** DTO Swagger d'`AgregatTempsLigneOr` (`GET /pointages/agregats-ligne`). */
export class AgregatTempsLigneOrDto implements AgregatTempsLigneOr {
  @ApiProperty({ format: 'uuid' })
  readonly ligneOrId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty({
    description:
      'Somme des `dureeArrondieCentiemes` des pointages fermés/validés/verrouillés de cette ligne.',
  })
  readonly dureePointeeCentiemes!: number;

  @ApiProperty()
  readonly nombrePointages!: number;

  @ApiProperty({ description: 'Un pointage `en_cours` porte-t-il actuellement sur cette ligne ?' })
  readonly pointageEnCours!: boolean;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Miroir de `ligne_or.tempsBaremeCentiemes`.',
  })
  readonly tempsBaremeCentiemes!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Pointé − barémé. Positif = dépassement. `null` si rien à comparer.',
  })
  readonly ecartCentiemes!: number | null;
}

/** DTO Swagger de `GET /pointages/agregats-ligne`. */
export class ReponseAgregatTempsLigneDto implements ReponseAgregatTempsLigne {
  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty({ type: () => [AgregatTempsLigneOrDto] })
  readonly lignes!: readonly AgregatTempsLigneOr[];
}
