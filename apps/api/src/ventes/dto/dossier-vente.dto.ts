import { ApiProperty } from '@nestjs/swagger';
import {
  ACTIONS_DOSSIER_VENTE,
  STATUTS_DOSSIER_VENTE,
  TYPES_VEHICULE_VENTE,
  type DocumentRequisDossierVente,
  type DossierVenteResume,
  type PageCurseur,
  type ReponseAvecAvertissements,
  type ReponseDossierVente,
} from '@dfa/shared';

import { AvertissementDto } from './avertissement.dto';
import { ClientResumeDto, ModifieParDto } from './communs.dto';
import { DocumentVenteResumeDto } from './document-vente-resume.dto';
import { FinancementResumeDto } from './financement.dto';
import { RepriseResumeDto } from './reprise.dto';
import { VehiculeStockResumeDto } from './vehicule-stock.dto';

export class DocumentRequisDossierVenteDto implements DocumentRequisDossierVente {
  @ApiProperty()
  readonly code!: string;

  @ApiProperty()
  readonly libelle!: string;

  @ApiProperty()
  readonly fourni!: boolean;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly fourniLe!: string | null;
}

export class DossierVenteResumeDto implements DossierVenteResume {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ enum: STATUTS_DOSSIER_VENTE })
  readonly statut!: DossierVenteResume['statut'];

  @ApiProperty({ enum: TYPES_VEHICULE_VENTE, nullable: true })
  readonly typeVehicule!: DossierVenteResume['typeVehicule'];

  @ApiProperty({ type: () => VehiculeStockResumeDto, nullable: true })
  readonly vehicule!: VehiculeStockResumeDto | null;

  @ApiProperty({ type: () => ClientResumeDto })
  readonly clientAcheteur!: ClientResumeDto;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  readonly dateLivraisonEstimee!: string | null;

  @ApiProperty({ format: 'date-time' })
  readonly prospectionLe!: string;
}

export class ReponseDossierVenteDto implements ReponseDossierVente {
  @ApiProperty({ format: 'uuid' })
  readonly id!: string;

  @ApiProperty({ format: 'uuid' })
  readonly siteId!: string;

  @ApiProperty({ enum: STATUTS_DOSSIER_VENTE })
  readonly statut!: ReponseDossierVente['statut'];

  @ApiProperty({
    enum: TYPES_VEHICULE_VENTE,
    nullable: true,
    description: 'Dérivé, jamais saisi (§8.2).',
  })
  readonly typeVehicule!: ReponseDossierVente['typeVehicule'];

  @ApiProperty({
    type: () => VehiculeStockResumeDto,
    nullable: true,
    description: 'null tant que non associé (RV-30).',
  })
  readonly vehicule!: VehiculeStockResumeDto | null;

  @ApiProperty({ type: () => ClientResumeDto })
  readonly clientAcheteur!: ClientResumeDto;

  @ApiProperty({
    type: () => ClientResumeDto,
    description: 'RV-40 : destinataire réel de la facture.',
  })
  readonly clientFacture!: ClientResumeDto;

  @ApiProperty({
    type: () => ClientResumeDto,
    nullable: true,
    description: 'null = le conducteur est l’acheteur (cas normal).',
  })
  readonly clientConducteur!: ClientResumeDto | null;

  @ApiProperty({
    type: () => RepriseResumeDto,
    nullable: true,
    description: 'null = pas de reprise sur ce dossier (RV-25).',
  })
  readonly reprise!: RepriseResumeDto | null;

  @ApiProperty({
    type: () => FinancementResumeDto,
    nullable: true,
    description: 'Le financement COURANT — null uniquement en prospection.',
  })
  readonly financement!: FinancementResumeDto | null;

  @ApiProperty({
    type: () => [FinancementResumeDto],
    description: 'Historique COMPLET des tentatives de financement (CV-03).',
  })
  readonly financements!: readonly FinancementResumeDto[];

  @ApiProperty()
  readonly financementsTronques!: boolean;

  @ApiProperty({ type: () => [DocumentVenteResumeDto] })
  readonly documents!: readonly DocumentVenteResumeDto[];

  @ApiProperty()
  readonly documentsTronques!: boolean;

  @ApiProperty({ type: () => [DocumentRequisDossierVenteDto] })
  readonly documentsRequis!: readonly DocumentRequisDossierVenteDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'RV-34 : type de pièce présentée à la signature du bon de commande.',
  })
  readonly identitePieceType!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly identiteVerifieeLe!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  readonly dateLivraisonEstimee!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  readonly dateLivraisonEffective!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'RV-55 : 0 pour un VN, kilométrage réel constaté pour une VO.',
  })
  readonly kilometrageDepart!: number | null;

  @ApiProperty({ format: 'date-time' })
  readonly prospectionLe!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly engageLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly enPreparationLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly pretALivrerLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly livreLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly closLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly annuleLe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  readonly abandonneLe!: string | null;

  @ApiProperty({ type: String, nullable: true })
  readonly motifCloture!: string | null;

  @ApiProperty({ enum: ACTIONS_DOSSIER_VENTE, isArray: true })
  readonly actionsDisponibles!: ReponseDossierVente['actionsDisponibles'];

  @ApiProperty()
  readonly version!: number;

  @ApiProperty({ format: 'date-time' })
  readonly creeLe!: string;

  @ApiProperty({ format: 'date-time' })
  readonly modifieLe!: string;

  @ApiProperty({ type: () => ModifieParDto, nullable: true })
  readonly modifiePar!: ModifieParDto | null;
}

export class PageDossierVenteDto implements PageCurseur<ReponseDossierVenteDto> {
  @ApiProperty({ type: () => [ReponseDossierVenteDto] })
  readonly donnees!: readonly ReponseDossierVenteDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Opaque base64url ; null = fin de liste.',
  })
  readonly curseurSuivant!: string | null;

  @ApiProperty({ example: 50 })
  readonly limite!: number;
}

export class DossierVenteAvecAvertissementsDto implements ReponseAvecAvertissements<ReponseDossierVenteDto> {
  @ApiProperty({ type: () => ReponseDossierVenteDto })
  readonly donnees!: ReponseDossierVenteDto;

  @ApiProperty({ type: () => [AvertissementDto] })
  readonly avertissements!: readonly AvertissementDto[];
}
