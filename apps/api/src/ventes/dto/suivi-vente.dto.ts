import { ApiProperty } from '@nestjs/swagger';
import {
  STATUTS_CONFIRMATION_FINANCEMENT,
  STATUTS_DOSSIER_VENTE,
  TYPES_FINANCEMENT_VENTE,
  type ClientSuiviVente,
  type LigneSuiviVente,
  type PageCurseur,
  type SuiviFinancement,
  type SuiviGarantie,
  type VehiculeSuiviVente,
} from '@dfa/shared';

/** Copie module-locale de `ClientResumeDto` réduite à `id`/`nomAffiche` — même doctrine que
 *  `FinancementOrganismeResumeDto` (`financement.dto.ts`), pas une dépendance vers ce dernier
 *  pour ne pas coupler deux DTO de forme accidentellement identique mais de provenance distincte. */
export class ClientSuiviVenteDto implements ClientSuiviVente {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly nomAffiche!: string;
}

export class VehiculeSuiviVenteDto implements VehiculeSuiviVente {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty()
  readonly designation!: string;

  @ApiProperty({ type: String, nullable: true })
  readonly vin!: string | null;
}

export class SuiviFinancementDto implements SuiviFinancement {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({
    enum: TYPES_FINANCEMENT_VENTE,
    description: '`comptant` jamais présent ici (RV-44).',
  })
  readonly type!: SuiviFinancement['type'];

  @ApiProperty({ enum: STATUTS_CONFIRMATION_FINANCEMENT })
  readonly statutConfirmation!: SuiviFinancement['statutConfirmation'];

  @ApiProperty({ type: () => ClientSuiviVenteDto, nullable: true })
  readonly organisme!: ClientSuiviVenteDto | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly confirmeLe!: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description:
      'Durée du contrat en mois. Omis si le rôle appelant ne voit pas les montants (RF-116).',
  })
  readonly dureeMois?: SuiviFinancement['dureeMois'];

  @ApiProperty({
    required: false,
    nullable: true,
    type: String,
    format: 'date',
    description:
      '`confirmeLe + dureeMois`, uniquement si `statutConfirmation = confirme` et les deux connues — jamais estimée. ' +
      'Omis si le rôle appelant ne voit pas les montants (RF-116).',
  })
  readonly echeanceLe?: SuiviFinancement['echeanceLe'];
}

export class SuiviGarantieDto implements SuiviGarantie {
  @ApiProperty({ type: String, format: 'date' })
  readonly debutLe!: string;

  @ApiProperty({ type: Number, nullable: true })
  readonly mois!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  readonly plafondKm!: number | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description: '`null` si `mois` est inconnu — aucune date de fin sans durée connue.',
  })
  readonly finLe!: string | null;

  @ApiProperty({
    description:
      "Vrai tant qu'aucune limite CONNUE (date ou kilométrage) n'est dépassée — même sémantique que " +
      '`GarantieVehicule.active` (contrats/atelier/vehicule.ts), calculée par la même fonction serveur.',
  })
  readonly active!: boolean;
}

export class LigneSuiviVenteDto implements LigneSuiviVente {
  @ApiProperty({ format: 'uuid' })
  readonly dossierVenteId!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ enum: STATUTS_DOSSIER_VENTE })
  readonly dossierStatut!: LigneSuiviVente['dossierStatut'];

  @ApiProperty({ type: () => ClientSuiviVenteDto })
  readonly clientAcheteur!: ClientSuiviVenteDto;

  @ApiProperty({
    type: () => VehiculeSuiviVenteDto,
    nullable: true,
    description:
      "null tant qu'aucun véhicule n'est associé (RV-30, dossier encore en prospection).",
  })
  readonly vehicule!: VehiculeSuiviVenteDto | null;

  @ApiProperty({
    type: () => SuiviFinancementDto,
    nullable: true,
    required: false,
    description:
      'Le financement COURANT du dossier, restreint aux types credit/leasing — null si aucun ' +
      "(RV-44), pour un rôle autorisé. ABSENT (pas null) = le rôle appelant n'a pas " +
      'ventes.financement.lire (FAILLE CORRIGÉE, audit sécurité).',
  })
  readonly financement?: SuiviFinancementDto | null;

  @ApiProperty({
    type: () => SuiviGarantieDto,
    nullable: true,
    description:
      "null si le véhicule associé (ou aucun véhicule) n'a pas de garantieDebut renseigné.",
  })
  readonly garantie!: SuiviGarantieDto | null;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    description:
      "La plus proche des échéances VISIBLES par l'appelant (financement.echeanceLe si non omise, " +
      "garantie.finLe) — null si aucune des deux n'est calculable ou visible.",
  })
  readonly prochaineEcheanceLe!: string | null;
}

export class PageSuiviVenteDto implements PageCurseur<LigneSuiviVenteDto> {
  @ApiProperty({ type: () => [LigneSuiviVenteDto] })
  readonly donnees!: readonly LigneSuiviVenteDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque base64url ; null = fin de liste.',
  })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}
