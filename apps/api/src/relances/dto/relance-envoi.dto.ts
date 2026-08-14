import { ApiProperty } from '@nestjs/swagger';
import {
  CANAUX_MESSAGE_CLIENT,
  RAISONS_REJET_MESSAGE_CLIENT,
  STATUTS_ENVOI_RELANCE,
  type PageCurseur,
  type ReponseRelanceEnvoi,
} from '@dfa/shared';

/** Une ligne = une tentative d'envoi tracée dans `relance_envoi` (voir la doc du contrat
 *  `ReponseRelanceEnvoi`, `@dfa/shared`, pour ce que chaque champ porte et ce qu'il n'expose
 *  délibérément pas). */
export class RelanceEnvoiDto implements ReponseRelanceEnvoi {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly factureId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'F-2026-00042' })
  readonly factureNumero!: string | null;

  @ApiProperty({ example: 1 })
  readonly palier!: number;

  @ApiProperty({ enum: CANAUX_MESSAGE_CLIENT })
  readonly canal!: ReponseRelanceEnvoi['canal'];

  @ApiProperty({ example: 'client@exemple.ch' })
  readonly destinataire!: string;

  @ApiProperty({ enum: STATUTS_ENVOI_RELANCE })
  readonly statutEnvoi!: ReponseRelanceEnvoi['statutEnvoi'];

  @ApiProperty({ enum: RAISONS_REJET_MESSAGE_CLIENT, nullable: true })
  readonly raisonEchec!: ReponseRelanceEnvoi['raisonEchec'];

  @ApiProperty({ format: 'date-time' })
  readonly envoyeLe!: string;
}

export class PageRelanceEnvoiDto implements PageCurseur<RelanceEnvoiDto> {
  @ApiProperty({ type: () => [RelanceEnvoiDto] })
  readonly donnees!: readonly RelanceEnvoiDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
