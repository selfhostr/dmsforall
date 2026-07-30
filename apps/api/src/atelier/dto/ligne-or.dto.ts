import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BLOCAGES_LIGNE_OR,
  ORIGINES_LIGNE_OR,
  PAYEURS_LIGNE_OR,
  STATUTS_LIGNE_OR,
  TYPES_LIGNE_OR,
  URGENCES_TRAVAIL,
  type MontantsLigneOr,
  type ReponseLigneOr,
} from '@dfa/shared';

/** Absents en bloc pour un rôle sans droit aux montants (`ROLES_SANS_MONTANT`) — voir
 *  `mappeurs.ts`. Classe distincte pour que Swagger documente la forme exacte de `montants`. */
export class MontantsLigneOrDto implements MontantsLigneOr {
  @ApiProperty({ description: 'Signé : négatif pour une ligne de type `remise`.' })
  readonly montantHtCentimes!: number;

  @ApiProperty()
  readonly montantTvaCentimes!: number;

  @ApiProperty()
  readonly montantTtcCentimes!: number;
}

export class ReponseLigneOrDto implements ReponseLigneOr {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly ordreReparationId!: string;

  @ApiProperty({ description: "Rang d'affichage dans l'OR, stable." })
  readonly numeroOrdre!: number;

  @ApiProperty({ enum: TYPES_LIGNE_OR })
  readonly type!: ReponseLigneOr['type'];

  @ApiProperty({ enum: ORIGINES_LIGNE_OR, description: "`constatee` déclenche l'événement `ligne_or.constatee`." })
  readonly origine!: ReponseLigneOr['origine'];

  @ApiProperty({ enum: STATUTS_LIGNE_OR })
  readonly statut!: ReponseLigneOr['statut'];

  @ApiProperty({ enum: PAYEURS_LIGNE_OR, description: 'Les lignes `garage` sont valorisées à 0.00 (RM-70).' })
  readonly payeur!: ReponseLigneOr['payeur'];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "Désigne QUI, quand `payeur !== 'client'` (AC-08, MD-62, MD-67) : `null` pour `payeur = 'client'` ou " +
      "`'garage'`. Colonne `ligne_or.payeur_client_id` (migration 0017).",
  })
  readonly payeurClientId!: ReponseLigneOr['payeurClientId'];

  @ApiProperty({ enum: BLOCAGES_LIGNE_OR })
  readonly blocage!: ReponseLigneOr['blocage'];

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly referenceTexte!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Accroche étape 3 (stock pièces).' })
  readonly articleId!: string | null;

  @ApiProperty({ example: 1000, description: 'Millièmes. `2500` = 2,5.' })
  readonly quantiteMillieme!: number;

  @ApiProperty({ type: Number, nullable: true })
  readonly tempsBaremeCentiemes!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'RM-69 : barème constructeur, conservé même si le garage applique le sien.' })
  readonly tempsBaremeConstructeurCentiemes!: number | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Toujours `null` au lot 1 (module pointage absent, Δ4).' })
  readonly tempsReelCentiemes!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Figé à la création (RM-65). Absent pour un rôle sans montants.' })
  readonly tauxHoraireCentimes?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Figé à la création (RM-65). Absent pour un rôle sans montants.' })
  readonly prixUnitaireCentimes?: number | null;

  @ApiProperty({ example: 0 })
  readonly rabaisPourmille!: number;

  @ApiProperty({ example: 81 })
  readonly tauxTvaPourmille!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly figeLe!: string | null;

  @ApiPropertyOptional({ type: () => MontantsLigneOrDto, description: 'Absent pour un rôle sans droit aux montants.' })
  readonly montants?: MontantsLigneOr;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly technicienId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly codeOperation!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly codeDefaut!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly numeroSinistre!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly numeroAccord!: string | null;

  @ApiProperty({ enum: URGENCES_TRAVAIL, nullable: true })
  readonly urgence!: ReponseLigneOr['urgence'];

  @ApiProperty({ description: 'Une ligne de sécurité refusée déclenche `OR_RESERVE_SECURITE_REQUISE` à la restitution (§6.12).' })
  readonly securite!: boolean;

  @ApiProperty({ description: 'RM-77 : pièce apportée par le client (décharge).' })
  readonly fournieParClient!: boolean;

  @ApiProperty({ description: 'RM-78 : pièce remplacée que le client demande à récupérer.' })
  readonly aRestituer!: boolean;

  @ApiProperty()
  readonly restituee!: boolean;

  @ApiProperty({ type: String, nullable: true })
  readonly motifAnnulation!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Accroche étape 2 (facturation).' })
  readonly factureId!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;
}
