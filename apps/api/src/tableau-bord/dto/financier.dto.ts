import { ApiProperty } from '@nestjs/swagger';
import type {
  ChiffreAffairesPeriodeTableauBord,
  MargeIndisponibleTableauBord,
  MargesTableauBord,
  MargeVehiculesPeriodeTableauBord,
  ReponseFinancierTableauBord,
  ValorisationStockPiecesTableauBord,
} from '@dfa/shared';

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

export class MargeVehiculesPeriodeTableauBordDto implements MargeVehiculesPeriodeTableauBord {
  @ApiProperty({
    description:
      'Revenu HT des documents véhicule de la période, moins le coût d’acquisition verrouillé (`vehicule_stock.prixAchatCentimes`). Calculable même à 0 (aucune vente = vraie donnée).',
  })
  readonly margeCentimes!: number;

  @ApiProperty({ description: 'Nombre de véhicules FACTURÉS entrant dans le calcul.' })
  readonly nombreVehiculesFactures!: number;
}

export class MargeIndisponibleTableauBordDto implements MargeIndisponibleTableauBord {
  @ApiProperty({ type: Boolean, description: 'Toujours `false` — jamais un montant fabriqué.' })
  readonly disponible!: false;

  @ApiProperty({
    description:
      'Clé i18n (namespace `tableauBord`, `financier.marges.indisponible.<clé>`) — jamais de texte figé émis par l’API.',
  })
  readonly raisonCle!: string;
}

export class MargesTableauBordDto implements MargesTableauBord {
  @ApiProperty({ type: MargeVehiculesPeriodeTableauBordDto })
  readonly vehicules!: MargeVehiculesPeriodeTableauBordDto;

  @ApiProperty({
    type: MargeIndisponibleTableauBordDto,
    description:
      'Coût de revient des pièces non fiable (`article.prixAchatCentimes` mutable, méthode de valorisation non tranchée) — toujours `disponible: false`.',
  })
  readonly pieces!: MargeIndisponibleTableauBordDto;

  @ApiProperty({
    type: MargeIndisponibleTableauBordDto,
    description: 'Aucun taux horaire coûtant modélisé — toujours `disponible: false`.',
  })
  readonly mainOeuvre!: MargeIndisponibleTableauBordDto;
}

export class ValorisationStockPiecesTableauBordDto implements ValorisationStockPiecesTableauBord {
  @ApiProperty({
    description:
      'Snapshot (PAS borné par la période) : Σ quantité physique × prix d’achat courant, articles actifs à prix connu seulement.',
  })
  readonly totalCentimes!: number;

  @ApiProperty({
    description:
      'Nombre d’articles actifs en stock (quantité > 0) sans prix d’achat connu, EXCLUS de `totalCentimes` — jamais comptés à 0.',
  })
  readonly articlesValeurInconnueNombre!: number;
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

  @ApiProperty({ type: MargesTableauBordDto })
  readonly marges!: MargesTableauBordDto;

  @ApiProperty({ type: ValorisationStockPiecesTableauBordDto })
  readonly stockPieces!: ValorisationStockPiecesTableauBordDto;
}
