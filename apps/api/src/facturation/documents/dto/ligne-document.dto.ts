import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  MODES_CALCUL_TVA,
  REGIMES_TVA,
  TYPES_LIGNE_DOCUMENT_VENTE,
  type MontantsLigneDocument,
  type ReponseLigneDocumentVente,
} from '@dfa/shared';

export class MontantsLigneDocumentDto implements MontantsLigneDocument {
  @ApiProperty()
  readonly montantHtCentimes!: number;

  @ApiProperty()
  readonly montantTvaCentimes!: number;

  @ApiProperty()
  readonly montantTtcCentimes!: number;

  @ApiProperty({ description: 'MD-66 : 0 sur les trois axes pour une ligne à charge du garage. Toujours = montantTtcCentimes ici (aucune ligne « payeur garage » ne provient de ce module).' })
  readonly montantFacturableCentimes!: number;

  @ApiProperty()
  readonly montantValoriseCentimes!: number;
}

export class ReponseLigneDocumentVenteDto implements ReponseLigneDocumentVente {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly documentId!: string;

  @ApiProperty()
  readonly numeroOrdre!: number;

  @ApiProperty({ enum: TYPES_LIGNE_DOCUMENT_VENTE })
  readonly type!: ReponseLigneDocumentVente['type'];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ligneOrId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly documentAcompteId!: string | null;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly referenceTexte!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Accroche étape 3 (stock pièces).' })
  readonly articleId!: string | null;

  @ApiProperty({ example: 1000, description: 'Millièmes — 1000 = quantité 1.' })
  readonly quantiteMillieme!: number;

  @ApiProperty({ type: Number, nullable: true, description: "TTC en centimes — null uniquement pour une ligne 'texte'." })
  readonly prixUnitaireTtcCentimes!: number | null;

  @ApiProperty({ enum: MODES_CALCUL_TVA, description: 'Lecture seule — toujours `ttc` pour toute ligne saisie via ce module (Δ-RF40).' })
  readonly modeCalculTva!: ReponseLigneDocumentVente['modeCalculTva'];

  @ApiProperty({ enum: REGIMES_TVA })
  readonly regimeTva!: ReponseLigneDocumentVente['regimeTva'];

  @ApiProperty({ example: 81 })
  readonly tauxTvaPourmille!: number;

  @ApiProperty({ format: 'date' })
  readonly datePrestation!: string;

  @ApiProperty({ type: Number, nullable: true })
  readonly remisePourmille!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly remiseMontantCentimes!: number | null;

  @ApiProperty()
  readonly remiseGlobaleRepartieCentimes!: number;

  @ApiPropertyOptional({ type: () => MontantsLigneDocumentDto, description: 'Absent pour un rôle sans droit aux montants.' })
  readonly montants?: MontantsLigneDocument;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}
