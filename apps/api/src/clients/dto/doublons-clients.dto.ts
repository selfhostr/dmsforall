import { ApiProperty } from '@nestjs/swagger';
import type { CandidatDoublonClient, ReponseDoublonsClients } from '@dfa/shared';

export class CandidatDoublonClientDto implements CandidatDoublonClient {
  @ApiProperty({ format: 'uuid' })
  readonly clientId!: string;

  @ApiProperty({ example: 'CL-000042' })
  readonly numeroClient!: string;

  @ApiProperty()
  readonly nom!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly npa!: string | null;

  @ApiProperty({ enum: ['nom_npa', 'email', 'telephone', 'ide'] })
  readonly critere!: CandidatDoublonClient['critere'];

  @ApiProperty({ minimum: 0, maximum: 1, example: 0.9 })
  readonly score!: number;
}

/** `GET /doublons-clients` — projection RM-05, consommée à la frappe, non paginée. */
export class ReponseDoublonsClientsDto implements ReponseDoublonsClients {
  @ApiProperty({ type: () => [CandidatDoublonClientDto] })
  readonly candidats!: readonly CandidatDoublonClientDto[];
}
