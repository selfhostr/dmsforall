import { ApiProperty } from '@nestjs/swagger';
import type { ChiffreAffairesPeriodeTableauBord, ReponseFinancierTableauBord } from '@dfa/shared';

import { PeriodeResolueTableauBordDto } from './activite.dto';

export class ChiffreAffairesPeriodeTableauBordDto implements ChiffreAffairesPeriodeTableauBord {
  @ApiProperty({ description: 'Net des avoirs émis sur la période (déjà négatifs en base).' })
  readonly totalHtCentimes!: number;

  @ApiProperty()
  readonly totalTvaCentimes!: number;

  @ApiProperty()
  readonly totalTtcCentimes!: number;

  @ApiProperty({ description: 'Nombre de factures + avoirs émis entrant dans la somme.' })
  readonly nombreDocuments!: number;
}

export class ReponseFinancierTableauBordDto implements ReponseFinancierTableauBord {
  @ApiProperty({ type: PeriodeResolueTableauBordDto })
  readonly periode!: PeriodeResolueTableauBordDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly siteId!: string | null;

  @ApiProperty({ type: ChiffreAffairesPeriodeTableauBordDto })
  readonly chiffreAffaires!: ChiffreAffairesPeriodeTableauBordDto;

  @ApiProperty({ description: 'Net des remboursements (déjà négatifs en base).' })
  readonly encaissementsCentimes!: number;

  @ApiProperty({
    description:
      'Snapshot au moment de l’appel (PAS borné par `periode`) : créances ouvertes sur les factures encore au statut `emis`.',
  })
  readonly encoursClientsCentimes!: number;
}
