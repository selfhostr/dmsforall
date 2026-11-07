import { ApiProperty } from '@nestjs/swagger';
import type { ReponseEtatDemarrage } from '@dfa/shared';

export class EtapesDemarrageDto {
  @ApiProperty({ description: 'Nom, rue, NPA et localité du bloc créancier renseignés.' })
  readonly coordonnees!: boolean;
  @ApiProperty({ description: 'IBAN ou QR-IBAN renseigné.' })
  readonly iban!: boolean;
  @ApiProperty({ description: 'Numéro TVA du garage saisi.' })
  readonly numeroTva!: boolean;
  @ApiProperty({ description: 'Au moins un taux horaire.' })
  readonly tauxHoraire!: boolean;
  @ApiProperty({ description: 'Au moins un motif de rendez-vous actif.' })
  readonly motifsRdv!: boolean;
  @ApiProperty({ description: 'Un compte de personne autre que le vôtre (invité ou actif).' })
  readonly premierCollaborateur!: boolean;
  @ApiProperty({ description: 'Au moins une borne d’atelier active.' })
  readonly borne!: boolean;
}

export class ReponseEtatDemarrageDto implements ReponseEtatDemarrage {
  @ApiProperty({ type: () => EtapesDemarrageDto })
  readonly etapes!: EtapesDemarrageDto;
}
