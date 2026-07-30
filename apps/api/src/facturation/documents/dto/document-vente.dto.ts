import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DEVISES_FACTURATION,
  MOTIFS_AVOIR,
  NATURES_FACTURE,
  ORIGINES_DOCUMENT,
  PORTEES_AVOIR,
  REGIMES_TVA,
  STATUTS_DOCUMENT_VENTE,
  STATUTS_REGLEMENT_DOCUMENT,
  TYPES_DOCUMENT_VENTE,
  type AdresseStructureeQr,
  type DocumentVenteTva,
  type ReponseDocumentVente,
  type ReponseLigneDocumentVente,
  type ValeursFigeesDocument,
} from '@dfa/shared';

import { ReponseLigneDocumentVenteDto } from './ligne-document.dto';

export class AdresseStructureeQrDto implements AdresseStructureeQr {
  @ApiProperty()
  readonly rue!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly numero!: string | null;

  @ApiProperty()
  readonly npa!: string;

  @ApiProperty()
  readonly localite!: string;

  @ApiProperty({ example: 'CH' })
  readonly pays!: string;
}

export class ValeursFigeesDocumentDto implements ValeursFigeesDocument {
  @ApiProperty()
  readonly clientDesignation!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly clientIde!: string | null;

  @ApiProperty()
  readonly clientLangue!: string;

  @ApiProperty({ type: () => AdresseStructureeQrDto, nullable: true })
  readonly adresseFacturation!: AdresseStructureeQr | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true, description: 'Absent pour un rôle sans droit aux montants.' })
  readonly conditionsPaiement?: Readonly<Record<string, unknown>> | null;

  @ApiProperty({ type: String, nullable: true })
  readonly plaque!: string | null;
}

export class DocumentVenteTvaDto implements DocumentVenteTva {
  @ApiProperty({ enum: REGIMES_TVA })
  readonly regimeTva!: DocumentVenteTva['regimeTva'];

  @ApiProperty({ example: 81 })
  readonly tauxTvaPourmille!: number;

  @ApiProperty()
  readonly baseCentimes!: number;

  @ApiProperty()
  readonly tvaCentimes!: number;
}

const NOM_AFFICHE_PROPERTIES = { utilisateurId: { type: 'string' as const, format: 'uuid' }, nomAffiche: { type: 'string' as const } };

export class ReponseDocumentVenteDto implements ReponseDocumentVente {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: TYPES_DOCUMENT_VENTE })
  readonly typeDocument!: ReponseDocumentVente['typeDocument'];

  @ApiProperty({ enum: NATURES_FACTURE, nullable: true })
  readonly natureFacture!: ReponseDocumentVente['natureFacture'];

  @ApiProperty({ enum: ORIGINES_DOCUMENT })
  readonly origine!: ReponseDocumentVente['origine'];

  @ApiProperty({ type: String, nullable: true, example: '2026-00318' })
  readonly numero!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly numeroSequence!: number | null;

  @ApiProperty({ type: String, nullable: true })
  readonly numeroOrigine!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly exercice!: number | null;

  @ApiProperty({ enum: STATUTS_DOCUMENT_VENTE })
  readonly statut!: ReponseDocumentVente['statut'];

  @ApiPropertyOptional({ enum: STATUTS_REGLEMENT_DOCUMENT, nullable: true, description: 'Absent pour un rôle sans droit aux montants.' })
  readonly statutReglement?: ReponseDocumentVente['statutReglement'];

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly clientId!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly vehiculeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly dossierVenteId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly documentSourceId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly factureAnnuleeId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly annuleParAvoirId!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly remplaceId!: string | null;

  @ApiProperty({ type: () => ValeursFigeesDocumentDto })
  readonly figees!: ValeursFigeesDocument;

  @ApiProperty({ format: 'date' })
  readonly dateDocument!: string;

  @ApiProperty({ enum: DEVISES_FACTURATION })
  readonly devise!: ReponseDocumentVente['devise'];

  @ApiProperty()
  readonly tvaNonVentilee!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  readonly tauxTvaPourmilleDocument!: number | null;

  @ApiProperty()
  readonly mentionTvaInterdite!: boolean;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly totalHtCentimes?: number;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly totalTvaCentimes?: number;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly ecartRepriseCentimes?: number;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly totalTtcCentimes?: number;

  @ApiPropertyOptional({ type: () => [DocumentVenteTvaDto], description: 'Absent pour un rôle sans droit aux montants.' })
  readonly ventilationTva?: readonly DocumentVenteTva[];

  @ApiProperty({ type: Number, nullable: true })
  readonly remiseGlobaleSaisieCentimes!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly remiseGlobalePourmille!: number | null;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly montantRegleCentimes?: number;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly soldeCentimes?: number;

  @ApiProperty()
  readonly relanceNiveau!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly relanceLe!: string | null;

  @ApiProperty({ enum: MOTIFS_AVOIR, nullable: true })
  readonly motifAvoir!: ReponseDocumentVente['motifAvoir'];

  @ApiProperty({ type: String, nullable: true })
  readonly motifAvoirAutre!: string | null;

  @ApiProperty({ enum: PORTEES_AVOIR, nullable: true })
  readonly porteeAvoir!: ReponseDocumentVente['porteeAvoir'];

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true, description: 'Figé à l\'émission — propriété du sous-module `qr/`, toujours `null` ici.' })
  readonly qr!: ReponseDocumentVente['qr'];

  @ApiProperty({ type: String, nullable: true })
  readonly pdfCle!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly pdfSha256!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly exporteLe!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly exportId!: string | null;

  @ApiProperty()
  readonly contentieux!: boolean;

  @ApiProperty({ type: () => [ReponseLigneDocumentVenteDto] })
  readonly lignes!: readonly ReponseLigneDocumentVente[];

  @ApiProperty()
  readonly nombreLignes!: number;

  @ApiProperty({ description: 'Au-delà de 200 lignes, `lignes` est tronqué : paginer `GET .../lignes`.' })
  readonly lignesTronquees!: boolean;

  @ApiProperty({ description: 'Rendu aussi en en-tête `ETag: W/"<version>"`.' })
  readonly version!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly emisLe!: string | null;

  @ApiProperty({ type: 'object', nullable: true, properties: NOM_AFFICHE_PROPERTIES })
  readonly emisPar!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;

  @ApiProperty({ type: 'object', nullable: true, properties: NOM_AFFICHE_PROPERTIES })
  readonly modifiePar!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}
