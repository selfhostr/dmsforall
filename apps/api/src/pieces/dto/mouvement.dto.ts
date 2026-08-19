import { ApiProperty } from '@nestjs/swagger';
import {
  TYPES_MOUVEMENT_STOCK,
  type PageCurseur,
  type ReponseApercuForcageMouvement,
  type ReponseAvecAvertissements,
  type ReponseMouvementStock,
  type ReservationMenaceeParForcage,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';

export class MouvementStockDto implements ReponseMouvementStock {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly articleId!: string;

  @ApiProperty({ enum: TYPES_MOUVEMENT_STOCK })
  readonly type!: ReponseMouvementStock['type'];

  @ApiProperty({
    description:
      'Signée (RP-17) : positive à l’entrée, négative à la sortie ; toujours positive pour `transfert`.',
  })
  readonly quantiteMillieme!: number;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly siteId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly siteSourceId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly siteDestinationId!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Uniquement pour entree_livraison (RP-29).',
  })
  readonly prixAchatReelCentimes!: number | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'null : mouvement issu d’une reprise de données ou d’un import.',
  })
  readonly auteurId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motif!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ligneOrId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly documentVenteLigneId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly commandeFournisseurLigneId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly inventaireReferenceId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly reservationId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;
}

/**
 * Réponse de `POST /articles/{id}/mouvements/ajustement-inventaire` : `donnees` est `null` quand
 * le compte correspond déjà au stock physique — aucun mouvement ne peut être créé
 * (`mouvement_stock_quantite_non_nulle_chk`, 0025). GAP DE CONTRAT inféré, voir `service-mouvement.ts`.
 */
export class MouvementAvecAvertissementsDto implements ReponseAvecAvertissements<MouvementStockDto | null> {
  @ApiProperty({ type: () => MouvementStockDto, nullable: true })
  readonly donnees!: MouvementStockDto | null;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}

/** Une réservation `active` que le forçage simulé (`GET .../apercu-forcage`) libérerait — voir
 *  `ReservationMenaceeParForcage` (`@dfa/shared`) pour la doctrine complète. */
export class ReservationMenaceeParForcageDto implements ReservationMenaceeParForcage {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ligneOrId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty()
  readonly ordreReparationNumero!: string;

  @ApiProperty()
  readonly quantiteMillieme!: number;
}

/** `GET /articles/{id}/mouvements/apercu-forcage` — voir `ReponseApercuForcageMouvement`
 *  (`@dfa/shared`) pour la doctrine complète (défaut n°2, test manuel du 14.08.2026). */
export class ApercuForcageMouvementDto implements ReponseApercuForcageMouvement {
  @ApiProperty({ type: () => [ReservationMenaceeParForcageDto] })
  readonly reservations!: readonly ReservationMenaceeParForcageDto[];
}

export class PageMouvementStockDto implements PageCurseur<MouvementStockDto> {
  @ApiProperty({ type: () => [MouvementStockDto] })
  readonly donnees!: readonly MouvementStockDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
