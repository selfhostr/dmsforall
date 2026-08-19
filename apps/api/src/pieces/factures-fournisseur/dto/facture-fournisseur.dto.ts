import { ApiProperty } from '@nestjs/swagger';
import {
  STATUTS_FACTURE_FOURNISSEUR,
  type ChampsOrigineFactureFournisseur,
  type EcartLigneFactureFournisseur,
  type OrigineDonneeFacture,
  type PageCurseur,
  type ReponseDocumentFactureFournisseur,
  type ReponseFactureFournisseur,
  type ReponseLigneFactureFournisseur,
  type StatutFactureFournisseur,
} from '@dfa/shared';

export class DocumentFactureFournisseurDto implements ReponseDocumentFactureFournisseur {
  @ApiProperty({ example: 'application/pdf' })
  readonly typeMime!: string;

  @ApiProperty()
  readonly tailleOctets!: number;

  @ApiProperty({ description: 'SHA-256 hexadécimal (64 caractères).' })
  readonly empreinteSha256!: string;

  @ApiProperty({ format: 'uuid' })
  readonly deposeParId!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  readonly deposeLe!: string;
}

export class EcartLigneFactureFournisseurDto implements EcartLigneFactureFournisseur {
  @ApiProperty({ description: 'Facturé − attendu, centimes signés.' })
  readonly prixUnitaireCentimes!: number;

  @ApiProperty({ description: 'Facturé − reliquat attendu, millièmes signés.' })
  readonly quantiteMillieme!: number;

  @ApiProperty({ description: 'Facturé − (prix attendu × quantité facturée), centimes signés.' })
  readonly totalCentimes!: number;
}

export class LigneFactureFournisseurDto implements ReponseLigneFactureFournisseur {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly numeroOrdre!: number;

  @ApiProperty({ type: String, nullable: true })
  readonly referenceArticle!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly designation!: string | null;

  @ApiProperty()
  readonly quantiteMillieme!: number;

  @ApiProperty({ type: Number, nullable: true })
  readonly prixUnitaireCentimes!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly totalLigneCentimes!: number | null;

  @ApiProperty({ enum: ['qr', 'texte_pdf', 'ocr'] })
  readonly origine!: OrigineDonneeFacture;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly articleId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly commandeFournisseurLigneId!: string | null;

  @ApiProperty({ type: EcartLigneFactureFournisseurDto, nullable: true })
  readonly ecart!: EcartLigneFactureFournisseur | null;
}

export class FactureFournisseurDto implements ReponseFactureFournisseur {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: STATUTS_FACTURE_FOURNISSEUR })
  readonly statut!: StatutFactureFournisseur;

  @ApiProperty({ type: DocumentFactureFournisseurDto })
  readonly document!: DocumentFactureFournisseurDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly fournisseurId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly commandeFournisseurId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly ibanCreancier!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly nomCreancier!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly numeroFacture!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  readonly dateFacture!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly montantTotalCentimes!: number | null;

  @ApiProperty({ example: 'CHF' })
  readonly devise!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly referencePaiement!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', enum: ['qr', 'texte_pdf', 'ocr'] },
    description: 'Provenance de chaque champ d’en-tête renseigné — clé absente = champ non trouvé.',
  })
  readonly champsOrigine!: ChampsOrigineFactureFournisseur;

  @ApiProperty({ type: () => [LigneFactureFournisseurDto] })
  readonly lignes!: readonly LigneFactureFournisseurDto[];

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly valideParId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly valideLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motifRejet!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  readonly modifieLe!: string;
}

export class PageFactureFournisseurDto implements PageCurseur<FactureFournisseurDto> {
  @ApiProperty({ type: () => [FactureFournisseurDto] })
  readonly donnees!: readonly FactureFournisseurDto[];

  @ApiProperty({ type: String, nullable: true })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
