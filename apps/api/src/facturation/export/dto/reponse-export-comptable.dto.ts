import { ApiProperty } from '@nestjs/swagger';
import {
  CIBLES_EXPORT,
  CODES_AVERTISSEMENT,
  MOYENS_PAIEMENT,
  type Avertissement,
  type CibleExport,
  type MoyenPaiement,
  type ReponseAvecAvertissements,
} from '@dfa/shared';

/** Sous-ensemble de `TYPES_DOCUMENT_VENTE` qui produit des écritures comptables (MD-84) — voir
 *  `TYPES_DOCUMENT_EXPORTABLES` dans `service-export-comptable.ts`, même liste, dupliquée ici
 *  uniquement pour la métadonnée Swagger (un import de la constante privée du service coderait
 *  une dépendance DTO → service dans le mauvais sens). */
const TYPES_DOCUMENT_EXPORTABLES_SWAGGER = ['facture', 'avoir'] as const;

import type {
  DocumentExporte,
  ImputationExportee,
  LotExportProduit,
  PaiementExporte,
  ReponseExportComptable,
} from '../service-export-comptable';

/** Dupliqué volontairement de `facturation/paiements/dto/paiement.dto.ts::AvertissementPaiementDto`
 *  — même raison que partout ailleurs dans ce module : pas de dépendance croisée entre
 *  sous-domaines de `facturation/`. Reste `[]` en pratique dans ce lot (voir `service-export-
 *  comptable.ts` : les avertissements WinBIZ — troncatures — voyagent dans `donnees.lots[].
 *  avertissements`, pas ici, faute de `CodeAvertissement` dédié dans le contrat gelé partagé). */
export class AvertissementExportDto implements Avertissement {
  @ApiProperty({ enum: CODES_AVERTISSEMENT })
  readonly code!: Avertissement['code'];

  @ApiProperty({ description: 'Libellé FR stable (support, logs). Jamais affiché par le front.' })
  readonly message!: string;

  @ApiProperty({ required: false, additionalProperties: true })
  readonly donnees?: Readonly<Record<string, unknown>>;
}

export class LotExportProduitDto implements LotExportProduit {
  @ApiProperty({
    format: 'uuid',
    description: 'Identifiant de la ligne `export_comptable` — figée à vie (MD-91).',
  })
  readonly exportId!: string;

  @ApiProperty({ enum: CIBLES_EXPORT })
  readonly cible!: CibleExport;

  @ApiProperty({
    description: 'Nom de fichier proposé (pas de stockage serveur — voir `contenuBase64`).',
  })
  readonly nomFichier!: string;

  @ApiProperty({ description: "Nombre d'écritures comptables (une par document, mode détaillé)." })
  readonly nbEcritures!: number;

  @ApiProperty({ description: 'Nombre de lignes du fichier CSV produit (en-tête comprise).' })
  readonly nbLignesCsv!: number;

  @ApiProperty({
    type: String,
    description: 'Total débit en centimes — chaîne (bigint, MD-85 : Σdébit = Σcrédit).',
  })
  readonly totalDebitCentimes!: string;

  @ApiProperty({
    type: String,
    description: 'Total crédit en centimes — chaîne (bigint), égal à `totalDebitCentimes`.',
  })
  readonly totalCreditCentimes!: string;

  @ApiProperty({ description: 'SHA-256 hexadécimal du contenu du fichier (MD-91, RF-111).' })
  readonly empreinteSha256!: string;

  @ApiProperty({
    description:
      "Contenu du fichier encodé base64 — aucun stockage serveur dans ce lot, à l'appelant de le persister.",
  })
  readonly contenuBase64!: string;

  @ApiProperty({
    type: [String],
    description:
      'Avertissements de sérialisation WinBIZ (troncatures de champs) — libellés FR, pas un CodeAvertissement du contrat gelé.',
  })
  readonly avertissements!: readonly string[];
}

export class DocumentExporteDto implements DocumentExporte {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ description: 'Numéro affiché du document (RF-108).' })
  readonly numero!: string;

  @ApiProperty({ enum: TYPES_DOCUMENT_EXPORTABLES_SWAGGER })
  readonly typeDocument!: DocumentExporte['typeDocument'];
}

/** `PaiementExporte` (migration 0019, MD-91) : liste UNIQUEMENT les paiements dont le CASH part
 *  dans CE lot — voir `ImputationExporteeDto` pour la granularité réelle du suivi d'export. */
export class PaiementExporteDto implements PaiementExporte {
  @ApiProperty({
    format: 'uuid',
    description:
      "Identifiant du paiement — pas de numéro affiché (MD-90), c'est la référence de l'écriture.",
  })
  readonly id!: string;

  @ApiProperty({ enum: MOYENS_PAIEMENT })
  readonly moyen!: MoyenPaiement;
}

/** Granularité réelle du suivi d'export côté paiement depuis la migration 0019 (MD-91) — une
 *  imputation peut partir SANS que son paiement apparaisse dans `paiementsExportes` (cash déjà
 *  transmis dans un lot antérieur, `MD-57` issue 2 : avance affectée plus tard à une facture). */
export class ImputationExporteeDto implements ImputationExportee {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly paiementId!: string;

  @ApiProperty({ format: 'uuid', description: 'Le document soldé par cette imputation.' })
  readonly documentId!: string;
}

export class ReponseExportComptableDto implements ReponseExportComptable {
  @ApiProperty({
    type: () => [LotExportProduitDto],
    description:
      'Un seul lot dans ce lot logiciel (MD-91 : un `export_comptable` par lot transmis) — un tableau vide si aucun document ni paiement candidat sur la période.',
  })
  readonly lots!: readonly LotExportProduitDto[];

  @ApiProperty({ type: () => [DocumentExporteDto] })
  readonly documentsExportes!: readonly DocumentExporteDto[];

  @ApiProperty({
    type: () => [PaiementExporteDto],
    description:
      "Paiements dont le CASH (compte financier) a été transmis dans ce lot — SEULEMENT la toute première fois qu'un paiement " +
      "est exporté (migration 0019). Une imputation tardive sur un paiement déjà encaissé n'y apparaît pas : voir `imputationsExportees`.",
  })
  readonly paiementsExportes!: readonly PaiementExporteDto[];

  @ApiProperty({
    type: () => [ImputationExporteeDto],
    description:
      "Imputations dont l'effet sur leur document (créance soldée, et le cas échéant escompte/perte/arrondi) a été transmis " +
      'dans ce lot — la granularité réelle du suivi (migration 0019, `imputation_paiement.exporteLe`).',
  })
  readonly imputationsExportees!: readonly ImputationExporteeDto[];
}

export class ExportComptableAvecAvertissementsDto implements ReponseAvecAvertissements<ReponseExportComptableDto> {
  @ApiProperty({ type: () => ReponseExportComptableDto })
  readonly donnees!: ReponseExportComptableDto;

  @ApiProperty({ type: () => [AvertissementExportDto] })
  readonly avertissements!: readonly AvertissementExportDto[];
}
