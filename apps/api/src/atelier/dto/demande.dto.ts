import { ApiProperty } from '@nestjs/swagger';
import type { ReponseOrdreReparationDemande } from '@dfa/shared';

export class ReponseOrdreReparationDemandeDto implements ReponseOrdreReparationDemande {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly ordre!: number;

  @ApiProperty({ description: 'VERBATIM du client (RM-52) : aucun `PATCH` n’existe, un verbatim est un fait.' })
  readonly verbatim!: string;

  @ApiProperty({ format: 'date-time' })
  readonly saisiLe!: string;

  @ApiProperty({ type: 'object', nullable: true, properties: { utilisateurId: { type: 'string', format: 'uuid' }, nomAffiche: { type: 'string' } } })
  readonly saisiPar!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}
