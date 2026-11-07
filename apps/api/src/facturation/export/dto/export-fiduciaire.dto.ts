import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CIBLES_EXPORT,
  MODES_GRANULARITE_EXPORT,
  REGIMES_TVA,
  USAGES_MAPPING_COMPTE,
  type ApercuExport,
  type CibleExport,
  type CodeTvaManquant,
  type CompteManquant,
  type EcritureDesequilibree,
  type EtatMappingExport,
  type ExportHistorique,
  type LimiteExport,
  type ModeGranulariteExport,
  type PageCurseur,
  type PlageNumeros,
  type PosteCodeTvaMapping,
  type PosteCompteMapping,
  type PrerequisExport,
  type RegimeTva,
  type TrouNumerotation,
  type UsageMappingCompte,
} from '@dfa/shared';

const CODES_PREREQUIS = [
  'EXPORT_MAPPING_INCOMPLET',
  'EXPORT_TROU_NUMEROTATION',
  'EXPORT_ECRITURES_DESEQUILIBREES',
  'FONCTION_NON_DISPONIBLE',
] as const;

export class PlageNumerosDto implements PlageNumeros {
  @ApiProperty() readonly premier!: string;
  @ApiProperty() readonly dernier!: string;
}

export class PlagesNumerosDto {
  @ApiProperty({ type: () => PlageNumerosDto, nullable: true })
  readonly factures!: PlageNumerosDto | null;
  @ApiProperty({ type: () => PlageNumerosDto, nullable: true })
  readonly avoirs!: PlageNumerosDto | null;
}

export class CompteManquantDto implements CompteManquant {
  @ApiProperty({ enum: USAGES_MAPPING_COMPTE }) readonly usage!: UsageMappingCompte;
  @ApiProperty({ description: 'defaut, type de ligne, moyen de paiement ou taux selon `usage`.' })
  readonly categorie!: string;
  @ApiProperty({ type: [String], description: 'Pièces concernées (10 au plus).' })
  readonly references!: readonly string[];
}

export class CodeTvaManquantDto implements CodeTvaManquant {
  @ApiProperty() readonly regimeTva!: string;
  @ApiProperty({ description: 'Valeur du taux telle que stockée (81 pour 8.1 %).' })
  readonly tauxPourmille!: number;
  @ApiProperty({ type: [String] }) readonly references!: readonly string[];
}

export class TrouNumerotationDto implements TrouNumerotation {
  @ApiProperty({ enum: ['facture', 'avoir'] }) readonly typeDocument!: 'facture' | 'avoir';
  @ApiProperty() readonly exercice!: number;
  @ApiProperty({ type: [String] }) readonly numeros!: readonly string[];
}

export class EcritureDesequilibreeDto implements EcritureDesequilibree {
  @ApiProperty() readonly reference!: string;
  @ApiProperty({ description: 'Centimes.' }) readonly totalDebitCentimes!: number;
  @ApiProperty({ description: 'Centimes.' }) readonly totalCreditCentimes!: number;
}

export class LimiteExportDto {
  @ApiProperty({
    enum: ['ADAPTATEUR_NON_CABLE', 'COMPENSATION_NON_SUPPORTEE', 'TAUX_MULTIPLES_NON_SUPPORTE'],
  })
  readonly code!: LimiteExport['code'];
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      '`ADAPTATEUR_NON_CABLE` : { cible } ; `COMPENSATION_NON_SUPPORTEE` : { paiementId, documentId } ; `TAUX_MULTIPLES_NON_SUPPORTE` : { paiementId, documentId, nature }.',
  })
  readonly donnees!: Readonly<Record<string, unknown>>;
}

/**
 * Union discriminée par `code` (OpenAPI : un seul schéma, les champs utiles selon le code) :
 * `EXPORT_MAPPING_INCOMPLET` → `comptes` + `codesTva` ; `EXPORT_TROU_NUMEROTATION` → `trous` ;
 * `EXPORT_ECRITURES_DESEQUILIBREES` → `ecritures` ; `FONCTION_NON_DISPONIBLE` → `limites`.
 */
export class PrerequisExportDto {
  @ApiProperty({ enum: CODES_PREREQUIS }) readonly code!: PrerequisExport['code'];
  @ApiPropertyOptional({ type: () => [CompteManquantDto] })
  readonly comptes?: readonly CompteManquantDto[];
  @ApiPropertyOptional({ type: () => [CodeTvaManquantDto] })
  readonly codesTva?: readonly CodeTvaManquantDto[];
  @ApiPropertyOptional({ type: () => [TrouNumerotationDto] })
  readonly trous?: readonly TrouNumerotationDto[];
  @ApiPropertyOptional({ type: () => [EcritureDesequilibreeDto] })
  readonly ecritures?: readonly EcritureDesequilibreeDto[];
  @ApiPropertyOptional({
    type: [String],
    deprecated: true,
    description: 'Libellés français (support, logs). L’écran lit `details`.',
  })
  readonly limites?: readonly string[];
  @ApiPropertyOptional({
    type: () => [LimiteExportDto],
    description: 'Les mêmes limites, en données structurées à traduire côté écran.',
  })
  readonly details?: readonly LimiteExportDto[];
}

class ApercuDocumentsDto {
  @ApiProperty() readonly nbFactures!: number;
  @ApiProperty() readonly nbAvoirs!: number;
  @ApiProperty({ description: 'Émis et non exportés.' }) readonly aExporter!: number;
  @ApiProperty({ description: 'Émis sur la période, déjà partis dans un lot antérieur.' })
  readonly dejaExportes!: number;
  @ApiProperty({ description: 'Dont factures (`dejaExportes` = factures + avoirs).' })
  readonly dejaExportesFactures!: number;
  @ApiProperty({ description: 'Dont avoirs.' })
  readonly dejaExportesAvoirs!: number;
}

class ApercuEncaissementsDto {
  @ApiProperty({ description: "Paiements dont le cash n'est jamais parti." })
  readonly aExporter!: number;
  @ApiProperty() readonly dejaExportes!: number;
  @ApiProperty({ description: 'Imputations (lettrages) non exportées.' })
  readonly imputationsAExporter!: number;
}

class ApercuTotauxDto {
  @ApiProperty({ description: 'Centimes, avoirs en négatif.' }) readonly htCentimes!: number;
  @ApiProperty({ description: 'Centimes.' }) readonly tvaCentimes!: number;
  @ApiProperty({ description: 'Centimes.' }) readonly ttcCentimes!: number;
}

export class ApercuExportDto implements ApercuExport {
  @ApiProperty({ enum: CIBLES_EXPORT }) readonly cible!: CibleExport;
  @ApiProperty({ format: 'date' }) readonly periodeDu!: string;
  @ApiProperty({ format: 'date' }) readonly periodeAu!: string;
  @ApiProperty({ type: () => ApercuDocumentsDto }) readonly documents!: ApercuDocumentsDto;
  @ApiProperty({ type: () => ApercuEncaissementsDto })
  readonly encaissements!: ApercuEncaissementsDto;
  @ApiProperty({ type: () => ApercuTotauxDto }) readonly totaux!: ApercuTotauxDto;
  @ApiProperty({ type: () => PlagesNumerosDto }) readonly plageNumeros!: PlagesNumerosDto;
  @ApiProperty({
    type: () => [PrerequisExportDto],
    description:
      'Vide = rien ne bloque. Mêmes éléments que les `blocages` des 409 du déclenchement.',
  })
  readonly prerequis!: readonly PrerequisExport[];
  @ApiProperty() readonly aQuelqueChoseAExporter!: boolean;
  @ApiProperty({ description: '`aQuelqueChoseAExporter` et aucun prérequis non satisfait.' })
  readonly exportable!: boolean;
}

export class ExportHistoriqueDto implements ExportHistorique {
  @ApiProperty({ format: 'uuid' }) readonly id!: string;
  @ApiProperty({ format: 'date-time', description: 'UTC.' }) readonly genereLe!: string;
  @ApiProperty({ format: 'date' }) readonly periodeDu!: string;
  @ApiProperty({ format: 'date' }) readonly periodeAu!: string;
  @ApiProperty({ enum: CIBLES_EXPORT }) readonly cible!: CibleExport;
  @ApiProperty({ enum: MODES_GRANULARITE_EXPORT }) readonly granularite!: ModeGranulariteExport;
  @ApiProperty() readonly statut!: string;
  @ApiProperty() readonly nbEcritures!: number;
  @ApiProperty({ description: 'Centimes.' }) readonly totalDebitCentimes!: number;
  @ApiProperty({ description: 'Centimes.' }) readonly totalCreditCentimes!: number;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'null : lot antérieur à la migration 0084.',
  })
  readonly nbFactures!: number | null;
  @ApiProperty({ nullable: true, type: Number }) readonly nbAvoirs!: number | null;
  @ApiProperty({ nullable: true, type: Number }) readonly nbEncaissements!: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Centimes.' })
  readonly totalHtCentimes!: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Centimes.' })
  readonly totalTvaCentimes!: number | null;
  @ApiProperty({ nullable: true, type: Number, description: 'Centimes.' })
  readonly totalTtcCentimes!: number | null;
  @ApiProperty({ type: () => PlagesNumerosDto }) readonly plageNumeros!: PlagesNumerosDto;
  @ApiProperty({ format: 'uuid', nullable: true, type: String }) readonly genereParId!:
    string | null;
  @ApiProperty({ nullable: true, type: String }) readonly genereParNom!: string | null;
  @ApiProperty({ description: 'SHA-256 hexadécimal du fichier.' })
  readonly empreinteSha256!: string;
  @ApiProperty({ nullable: true, type: String }) readonly nomFichier!: string | null;
  @ApiProperty({ description: 'false : lot antérieur à la migration 0084, fichier non conservé.' })
  readonly fichierDisponible!: boolean;
}

export class PageExportsDto implements PageCurseur<ExportHistoriqueDto> {
  @ApiProperty({ type: () => [ExportHistoriqueDto] })
  readonly donnees!: readonly ExportHistoriqueDto[];
  @ApiProperty({ nullable: true, type: String, description: 'Opaque ; null = fin de liste.' })
  readonly curseurSuivant!: string | null;
  @ApiProperty() readonly limite!: number;
}

export class PosteCompteMappingDto implements PosteCompteMapping {
  @ApiProperty({ enum: USAGES_MAPPING_COMPTE }) readonly usage!: UsageMappingCompte;
  @ApiProperty() readonly categorie!: string;
  @ApiProperty({
    description: 'Libellé FR stable (support) — le front rend le poste depuis usage + categorie.',
  })
  readonly libelle!: string;
  @ApiProperty({
    nullable: true,
    type: String,
    description: "Compte actif aujourd'hui ; null = non réglé.",
  })
  readonly compte!: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date' }) readonly actifDu!: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'Suggestion du plan PME suisse, à valider avec la fiduciaire.',
  })
  readonly compteParDefaut!: string | null;
  @ApiProperty() readonly requis!: boolean;
}

export class PosteCodeTvaMappingDto implements PosteCodeTvaMapping {
  @ApiProperty({ enum: REGIMES_TVA }) readonly regimeTva!: RegimeTva;
  @ApiProperty({ description: '81 pour 8.1 %.' }) readonly tauxPourmille!: number;
  @ApiProperty() readonly libelle!: string;
  @ApiProperty({ nullable: true, type: String }) readonly codeExterne!: string | null;
  @ApiProperty({ nullable: true, type: String }) readonly codeParDefaut!: string | null;
  @ApiProperty() readonly requis!: boolean;
}

export class EtatMappingExportDto implements EtatMappingExport {
  @ApiProperty({ enum: CIBLES_EXPORT }) readonly cible!: CibleExport;
  @ApiProperty({
    description: 'Tous les postes `requis` sont réglés (aperçu = vérité par période).',
  })
  readonly complet!: boolean;
  @ApiProperty() readonly nbPostesManquants!: number;
  @ApiProperty({ type: () => [PosteCompteMappingDto] })
  readonly comptes!: readonly PosteCompteMappingDto[];
  @ApiProperty({ type: () => [PosteCodeTvaMappingDto] })
  readonly codesTva!: readonly PosteCodeTvaMappingDto[];
}
