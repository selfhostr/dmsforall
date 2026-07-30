import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ACTIONS_ORDRE_REPARATION,
  ETATS_AFFICHES_ORDRE_REPARATION,
  LOCALISATIONS_VEHICULE,
  MOTIFS_LIEN_OR,
  PAYEURS_LIGNE_OR,
  STATUTS_ORDRE_REPARATION,
  TYPES_ORDRE_REPARATION,
  type ActionOrdreReparation,
  type AttentesOr,
  type ClientResume,
  type CumulsPointageOr,
  type OrdreReparationResume,
  type ReponseControleQualiteOr,
  type ReponseDevisComplementaire,
  type ReponseLigneOr,
  type ReponseOrdreReparation,
  type ReponseOrdreReparationDemande,
  type ReponseSignatureOr,
  type TotauxPayeurOr,
  type ValeursFigeesOr,
  type VehiculeResume,
} from '@dfa/shared';

import { ReponseDevisComplementaireDto } from './devis.dto';
import { ReponseOrdreReparationDemandeDto } from './demande.dto';
import { ReponseLigneOrDto } from './ligne-or.dto';
import { ClientResumeOrDto, VehiculeResumeOrDto } from './resumes.dto';

/**
 * DTO Swagger du document OR complet (`GET /ordres-reparation/{orId}`, §8.3) — LE document, pas un
 * agrégat d'écran (voir l'en-tête du contrat `ordre-reparation.ts`). Toutes les actions de §7.7 en
 * rendent une instance dans leur enveloppe.
 */
export class ValeursFigeesOrDto implements ValeursFigeesOr {
  @ApiProperty()
  readonly clientDesignation!: string;

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true })
  readonly adresseFacturation!: Readonly<Record<string, unknown>> | null;

  @ApiPropertyOptional({ type: 'object', nullable: true, additionalProperties: true, description: 'Absentes pour un rôle sans montants.' })
  readonly conditions?: Readonly<Record<string, unknown>> | null;

  @ApiProperty({ type: String, nullable: true })
  readonly plaque!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly detenteurClientId!: string | null;
}

export class AttentesOrDto implements AttentesOr {
  @ApiProperty({ description: 'Un devis complémentaire attend une réponse.' })
  readonly accord!: boolean;

  @ApiProperty({ description: 'Une ligne bloquée « pièces » attend un approvisionnement.' })
  readonly pieces!: boolean;

  @ApiProperty({ description: 'Une ligne bloquée « externe » attend un tiers (sous-traitant, expertise…).' })
  readonly externe!: boolean;
}

export class PointControleDto {
  @ApiProperty()
  readonly code!: string;

  @ApiProperty()
  readonly libelle!: string;

  @ApiProperty({ type: Boolean, nullable: true })
  readonly conforme!: boolean | null;
}

export class ControleQualiteOrDto implements ReponseControleQualiteOr {
  @ApiProperty({ format: 'uuid' })
  readonly controleurId!: string;

  @ApiProperty({ format: 'date-time' })
  readonly controleLe!: string;

  @ApiProperty()
  readonly conforme!: boolean;

  @ApiProperty({ type: String, nullable: true })
  readonly motifNonConformite!: string | null;

  @ApiProperty({ type: () => [PointControleDto], description: 'Check-lists outillées = lot 2 (P-08 `selon_type`) ; toujours vide au lot 1.' })
  readonly pointsControles!: readonly { readonly code: string; readonly libelle: string; readonly conforme: boolean | null }[];
}

export class SignatureOrDto implements ReponseSignatureOr {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: ['reception', 'restitution', 'reserve_securite'] })
  readonly type!: ReponseSignatureOr['type'];

  @ApiProperty()
  readonly signataireNom!: string;

  @ApiProperty({ format: 'date-time' })
  readonly signeLe!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly appareil!: string | null;
}

export class CumulTechnicienDto {
  @ApiProperty({ format: 'uuid' })
  readonly technicienId!: string;

  @ApiProperty()
  readonly nomAffiche!: string;

  @ApiProperty()
  readonly centiemes!: number;
}

export class CumulsPointageOrDto implements CumulsPointageOr {
  @ApiProperty({ description: 'Toujours 0 au lot 1 (module pointage absent, Δ4).' })
  readonly totalCentiemes!: number;

  @ApiProperty({ type: () => [CumulTechnicienDto] })
  readonly parTechnicien!: readonly { readonly technicienId: string; readonly nomAffiche: string; readonly centiemes: number }[];

  @ApiProperty()
  readonly pointagesOuverts!: number;
}

export class VentilationTvaDto {
  @ApiProperty({ example: 81 })
  readonly tauxPourmille!: number;

  @ApiProperty()
  readonly baseHtCentimes!: number;

  @ApiProperty()
  readonly montantCentimes!: number;
}

const DESTINATAIRE_PAYEUR_PROPERTIES = { clientId: { type: 'string' as const, format: 'uuid' }, nomAffiche: { type: 'string' as const } };

export class TotauxPayeurOrDto implements TotauxPayeurOr {
  @ApiProperty({ enum: PAYEURS_LIGNE_OR })
  readonly payeur!: TotauxPayeurOr['payeur'];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "Clé de regroupement, DEUXIÈME MOITIÉ (MD-62 : regroupement par `(payeur, payeurClientId)`, jamais " +
      "`payeur` seul — deux assureurs sur le même OR sont deux groupes distincts). `null` pour `payeur = " +
      "'client'` (destinataire = l'OR lui-même) et pour `'garage'` (RF-92, fusionné dans le groupe `'client'`, " +
      "n'apparaît donc jamais ici). Colonne `ligne_or.payeur_client_id` (migration 0017).",
  })
  readonly payeurClientId!: TotauxPayeurOr['payeurClientId'];

  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: DESTINATAIRE_PAYEUR_PROPERTIES,
    description:
      "Projection minimale du destinataire réel de ce groupe (RF-87), résolu via `common/identite-client/` " +
      "(RM-01 : le `type` du client fait autorité pour le nom affiché). `null` uniquement pour `payeur = " +
      "'garage'` (personne, RF-92) — n'apparaît jamais ici, fusionné dans `'client'`.",
  })
  readonly destinataire!: TotauxPayeurOr['destinataire'];

  @ApiProperty()
  readonly montantHtCentimes!: number;

  @ApiProperty()
  readonly montantTvaCentimes!: number;

  @ApiProperty()
  readonly montantTtcCentimes!: number;

  @ApiProperty({ type: () => [VentilationTvaDto] })
  readonly tva!: readonly { readonly tauxPourmille: number; readonly baseHtCentimes: number; readonly montantCentimes: number }[];
}

const NOM_AFFICHE_PROPERTIES = { utilisateurId: { type: 'string' as const, format: 'uuid' }, nomAffiche: { type: 'string' as const } };

export class ReponseOrdreReparationDto implements ReponseOrdreReparation {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ example: 'OR-2026-1042', description: 'Numéro continu (RM-49), brûlé dans la transaction métier.' })
  readonly numero!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ enum: TYPES_ORDRE_REPARATION })
  readonly type!: ReponseOrdreReparation['type'];

  @ApiProperty({ enum: STATUTS_ORDRE_REPARATION })
  readonly statut!: ReponseOrdreReparation['statut'];

  @ApiProperty({ type: () => ClientResumeOrDto })
  readonly client!: ClientResume;

  @ApiProperty({ type: () => VehiculeResumeOrDto })
  readonly vehicule!: VehiculeResume;

  @ApiProperty({ type: () => ValeursFigeesOrDto })
  readonly figees!: ValeursFigeesOr;

  @ApiProperty({ type: String, nullable: true })
  readonly conducteurPresentNom!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly kilometrageEntree!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly kilometrageSortie!: number | null;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly plafondCentimes?: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Absent pour un rôle sans droit aux montants.' })
  readonly plafondAutorisePar?: string | null;

  @ApiPropertyOptional({ description: 'Dérivé, maintenu par trigger (RM-54). Absent pour un rôle sans droit aux montants.' })
  readonly totalValideCentimes?: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly restitutionPromiseLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'RM-56 : la promesse INITIALE, conservée pour que le report soit visible et motivé.' })
  readonly restitutionInitialeLe!: string | null;

  @ApiProperty({ enum: LOCALISATIONS_VEHICULE })
  readonly localisation!: ReponseOrdreReparation['localisation'];

  @ApiProperty({ type: String, nullable: true })
  readonly sousTraitantNom!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly ordreReparationParentId!: string | null;

  @ApiProperty({ enum: MOTIFS_LIEN_OR, nullable: true })
  readonly motifLien!: ReponseOrdreReparation['motifLien'];

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: 'Accroche lot 3 (planning).' })
  readonly rendezVousId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "RM-14 : la « PO » du client entreprise. Son absence bloque `OR_PO_MANQUANT`." })
  readonly numeroCommandeInterne!: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  readonly receptionnaireId!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly retentionInvoqueeLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly litigeOuvertLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly ouvertLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly termineLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly factureLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly restitueLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly clotureLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly annuleLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motifAnnulation!: string | null;

  @ApiProperty({ type: () => [ReponseOrdreReparationDemandeDto] })
  readonly demandes!: readonly ReponseOrdreReparationDemande[];

  @ApiProperty({ type: () => [ReponseLigneOrDto] })
  readonly lignes!: readonly ReponseLigneOr[];

  @ApiProperty()
  readonly nombreLignes!: number;

  @ApiProperty({ description: 'Au-delà de 200 lignes (`SEUIL_LIGNES_EMBARQUEES`), `lignes` est tronqué : paginer `GET .../lignes`.' })
  readonly lignesTronquees!: boolean;

  @ApiProperty({ type: () => [ReponseDevisComplementaireDto] })
  readonly devisComplementaires!: readonly ReponseDevisComplementaire[];

  @ApiProperty({ type: () => ControleQualiteOrDto, nullable: true })
  readonly controleQualite!: ReponseControleQualiteOr | null;

  @ApiProperty({ type: () => [SignatureOrDto] })
  readonly signatures!: readonly ReponseSignatureOr[];

  @ApiProperty({ type: 'object', nullable: true, additionalProperties: true, description: 'Prêt de véhicule de courtoisie lié. Toujours `null` au lot 1 (module lot 5).' })
  readonly pret!: Readonly<Record<string, unknown>> | null;

  @ApiProperty({ type: () => CumulsPointageOrDto })
  readonly cumulsPointage!: CumulsPointageOr;

  @ApiPropertyOptional({ type: () => [TotauxPayeurOrDto], description: 'Absent pour un rôle sans droit aux montants.' })
  readonly totauxParPayeur?: readonly TotauxPayeurOr[];

  @ApiProperty({ type: () => AttentesOrDto })
  readonly attentes!: AttentesOr;

  @ApiProperty({ enum: ETATS_AFFICHES_ORDRE_REPARATION, description: 'Le plus bloquant des attentes, sinon le statut. Calculé UNE FOIS côté serveur.' })
  readonly etatAffiche!: ReponseOrdreReparation['etatAffiche'];

  @ApiProperty({ enum: ACTIONS_ORDRE_REPARATION, isArray: true, description: 'Actions possibles pour l’appelant courant (statut + droits + paramètres). N’exempte pas de la vérification serveur.' })
  readonly actionsDisponibles!: readonly ActionOrdreReparation[];

  @ApiProperty({ description: 'Entier monotone, aussi rendu en en-tête `ETag: W/"<version>"`.' })
  readonly version!: number;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;

  @ApiProperty({ type: 'object', nullable: true, properties: NOM_AFFICHE_PROPERTIES })
  readonly modifiePar!: { readonly utilisateurId: string; readonly nomAffiche: string } | null;
}

/** Projection minimale d'un OR, embarquée dans les listes, la recherche et le contexte-atelier. */
export class OrdreReparationResumeDto implements OrdreReparationResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly numero!: string;

  @ApiProperty({ enum: STATUTS_ORDRE_REPARATION })
  readonly statut!: OrdreReparationResume['statut'];

  @ApiProperty({ enum: ETATS_AFFICHES_ORDRE_REPARATION })
  readonly etatAffiche!: OrdreReparationResume['etatAffiche'];

  @ApiProperty({ enum: TYPES_ORDRE_REPARATION })
  readonly type!: OrdreReparationResume['type'];

  @ApiProperty({ enum: LOCALISATIONS_VEHICULE })
  readonly localisation!: OrdreReparationResume['localisation'];

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly ouvertLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly restitutionPromiseLe!: string | null;

  @ApiProperty({ type: () => VehiculeResumeOrDto })
  readonly vehicule!: VehiculeResume;

  @ApiProperty({ type: () => ClientResumeOrDto })
  readonly client!: ClientResume;

  @ApiProperty()
  readonly nombreLignes!: number;

  @ApiPropertyOptional({ description: 'Absent pour un rôle sans droit aux montants.' })
  readonly totalTtcCentimes?: number;
}
