import { ApiProperty } from '@nestjs/swagger';
import {
  CODES_AVERTISSEMENT,
  DEVISES_FACTURATION,
  ISSUES_AVANCE_CLIENT,
  MOYENS_PAIEMENT,
  NATURES_IMPUTATION,
  SOURCES_PAIEMENT,
  type Avertissement,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseImputationPaiement,
  type ReponsePaiement,
} from '@dfa/shared';

/** Dupliqué volontairement de `apps/api/src/clients/dto/avertissement.dto.ts` — même raison que
 *  partout ailleurs dans ce module : pas de dépendance `facturation/ → clients/` dans ce dépôt. */
export class AvertissementPaiementDto implements Avertissement {
  @ApiProperty({ enum: CODES_AVERTISSEMENT })
  readonly code!: Avertissement['code'];

  @ApiProperty({ description: 'Libellé FR stable (support, logs). Jamais affiché par le front.' })
  readonly message!: string;

  @ApiProperty({ required: false, additionalProperties: true })
  readonly donnees?: Readonly<Record<string, unknown>>;
}

const AUTEUR_PROPERTIES = { utilisateurId: { type: 'string' as const, format: 'uuid' }, nomAffiche: { type: 'string' as const } };

export class ReponseImputationPaiementDto implements ReponseImputationPaiement {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly paiementId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly documentId!: string;

  @ApiProperty({ description: 'Toujours positif sur ce lettrage (le signe vit sur le paiement, MD-50).' })
  readonly montantCentimes!: number;

  @ApiProperty({ enum: NATURES_IMPUTATION })
  readonly nature!: ReponseImputationPaiement['nature'];

  @ApiProperty({ type: String, format: 'date-time' })
  readonly imputeLe!: string;

  @ApiProperty({ type: 'object', nullable: true, properties: AUTEUR_PROPERTIES })
  readonly imputePar!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

export class ReponsePaiementDto implements ReponsePaiement {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-07-29' })
  readonly dateValeur!: string;

  @ApiProperty({ enum: MOYENS_PAIEMENT })
  readonly moyen!: ReponsePaiement['moyen'];

  @ApiProperty({ description: 'Signé : négatif = remboursement ou contre-passation (MD-50).' })
  readonly montantCentimes!: number;

  @ApiProperty({ enum: DEVISES_FACTURATION })
  readonly devise!: ReponsePaiement['devise'];

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  readonly payeurClientId!: string | null;

  @ApiProperty({ description: "Figé — l'assurance, le leaser, le client (MD-50)." })
  readonly payeurLibelle!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly referenceQr!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly identifiantTransactionBanque!: string | null;

  @ApiProperty({ enum: SOURCES_PAIEMENT })
  readonly source!: ReponsePaiement['source'];

  @ApiProperty({ type: String, nullable: true, format: 'uuid', description: 'Paiement de sens opposé lié (MD-52, MD-57).' })
  readonly contrePasseId!: string | null;

  @ApiProperty({ type: () => [ReponseImputationPaiementDto] })
  readonly imputations!: readonly ReponseImputationPaiementDto[];

  @ApiProperty({ description: "montant − Σ imputations 'reglement' (MD-51.b) — une avance client non imputée si > 0 (RF-79)." })
  readonly montantNonImputeCentimes!: number;

  @ApiProperty({ enum: ISSUES_AVANCE_CLIENT, isArray: true })
  readonly issuesDisponibles!: ReponsePaiement['issuesDisponibles'];

  @ApiProperty({ type: String, format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ type: 'object', nullable: true, properties: AUTEUR_PROPERTIES })
  readonly creePar!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

export class PageReponsePaiementDto implements PageCurseur<ReponsePaiementDto> {
  @ApiProperty({ type: () => [ReponsePaiementDto] })
  readonly donnees!: readonly ReponsePaiementDto[];

  @ApiProperty({ type: String, nullable: true, description: 'Opaque base64url ; null = fin de liste.' })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class PaiementAvecAvertissementsDto implements ReponseAvecAvertissements<ReponsePaiementDto> {
  @ApiProperty({ type: () => ReponsePaiementDto })
  readonly donnees!: ReponsePaiementDto;

  @ApiProperty({ type: () => [AvertissementPaiementDto] })
  readonly avertissements!: readonly AvertissementPaiementDto[];
}
